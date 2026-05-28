//! Full sync cycle orchestration.
//!
//! Runs `push → pull → apply → cursor advance` once. The HTTP layer is
//! gated behind a [`SupabaseConfig`]; without it the function returns
//! `AppError::Validation` straight away, which is the contract the command
//! layer relies on.
//!
//! This module is intentionally short because the heavy lifting lives in
//! [`super::delta`] and [`super::apply`].

use chrono::Utc;

use crate::db::Database;
use crate::error::{AppError, AppResult};

use super::auth::SupabaseConfig;
use super::client::SyncClient;
use super::{apply, delta, SyncReport, SyncSession};

/// One end-to-end sync cycle for a configured + logged-in user.
///
/// Pipeline:
///   1. Read the current cursor from `sync_state`.
///   2. Extract local deltas (decks, notes, cards, reviews).
///   3. Push them to Supabase (the client returns empty payloads until the
///      project is live, which is fine — we just go through the motions).
///   4. Pull remote deltas with the same cursor.
///   5. Apply them in a single SQLite transaction.
///   6. Bump `sync_state.last_sync_at` to `now()`.
pub async fn run_cycle(
    db: &Database,
    config: &SupabaseConfig,
    session: &SyncSession,
) -> AppResult<SyncReport> {
    // ---- 1. read cursor -----------------------------------------------------
    let since: i64 = {
        let conn = db.lock();
        conn.query_row(
            "SELECT COALESCE(last_sync_at, 0) FROM sync_state WHERE id = 1",
            [],
            |row| row.get(0),
        )?
    };

    // ---- 2. extract local deltas -------------------------------------------
    let (local_decks, local_notes, local_cards, local_reviews) = {
        let conn = db.lock();
        (
            delta::extract_decks(&conn, since)?,
            delta::extract_notes(&conn, since)?,
            delta::extract_cards(&conn, since)?,
            delta::extract_reviews(&conn, since)?,
        )
    };

    // ---- 3. push -----------------------------------------------------------
    let client = SyncClient::new(config, &session.access_token)?;
    let _ack_decks = client.push_decks(&local_decks).await?;
    let _ack_notes = client.push_notes(&local_notes).await?;
    let _ack_cards = client.push_cards(&local_cards).await?;
    let _ack_reviews = client.push_reviews(&local_reviews).await?;

    // ---- 4. pull -----------------------------------------------------------
    let remote_decks = client.pull_decks(since).await?;
    let remote_notes = client.pull_notes(since).await?;
    let remote_cards = client.pull_cards(since).await?;
    let remote_reviews = client.pull_reviews(since).await?;

    // ---- 5. apply (single transaction) -------------------------------------
    // The four `apply_*` calls run inside one manual transaction. We must
    // ROLLBACK on ANY error: a bare `BEGIN;` + `?` early-return would leave
    // the transaction open on the shared connection, so every later DB op
    // (including the next sync's `BEGIN;`) would fail with "cannot start a
    // transaction within a transaction" and partial writes would linger.
    let finished_at = Utc::now().timestamp();
    let (decks_stats, notes_stats, cards_stats, reviews_stats) = {
        let conn = db.lock();
        conn.execute_batch("BEGIN;")?;
        let applied = (|| {
            let decks_stats = apply::apply_decks(&conn, &remote_decks)?;
            let notes_stats = apply::apply_notes(&conn, &remote_notes)?;
            let cards_stats = apply::apply_cards(&conn, &remote_cards)?;
            let reviews_stats = apply::apply_reviews(&conn, &remote_reviews)?;
            apply::write_cursor(&conn, finished_at, Some(&session.user_id))?;
            Ok::<_, AppError>((decks_stats, notes_stats, cards_stats, reviews_stats))
        })();
        match applied {
            Ok(stats) => {
                conn.execute_batch("COMMIT;")?;
                stats
            }
            Err(e) => {
                // Best-effort rollback so the connection stays usable.
                let _ = conn.execute_batch("ROLLBACK;");
                return Err(e);
            }
        }
    };

    Ok(SyncReport {
        decks_pushed: local_decks.len(),
        decks_pulled: decks_stats.touched(),
        notes_pushed: local_notes.len(),
        notes_pulled: notes_stats.touched(),
        cards_pushed: local_cards.len(),
        cards_pulled: cards_stats.touched(),
        reviews_pushed: local_reviews.len(),
        reviews_pulled: reviews_stats.touched(),
        finished_at,
    })
}
