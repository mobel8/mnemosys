//! Full sync cycle orchestration.
//!
//! Runs `push → pull → apply → cursor advance` once. The HTTP layer is
//! gated behind a [`SupabaseConfig`]; without it the function returns
//! `AppError::Validation` straight away, which is the contract the command
//! layer relies on.
//!
//! This module is intentionally short because the heavy lifting lives in
//! [`super::delta`] and [`super::apply`].

use std::sync::atomic::{AtomicBool, Ordering};

use chrono::Utc;

use crate::db::Database;
use crate::error::{AppError, AppResult};

use super::auth::SupabaseConfig;
use super::client::SyncClient;
use super::{apply, delta, SyncReport, SyncSession};

/// P051 — process-wide « a sync is running » flag.
///
/// `run_cycle` opens a manual `BEGIN;` on the *single* SQLite connection shared
/// by the whole process. Two cycles overlapping (a second window, a programmatic
/// `invoke`, or a future auto-sync timer racing a manual one) would issue a
/// nested `BEGIN;` and fail with "cannot start a transaction within a
/// transaction" — possibly after the first cycle already pushed, leaving the DB
/// and the remote out of step. The UI `isPending` guard is per-window and can't
/// protect against this. A process-wide flag makes `run_cycle` mutually
/// exclusive regardless of who calls it.
static SYNC_IN_FLIGHT: AtomicBool = AtomicBool::new(false);

/// RAII token that releases [`SYNC_IN_FLIGHT`] on every exit path (normal
/// return, `?` early-return, or panic unwind), so a cycle that fails mid-flight
/// never wedges all future syncs into a permanent "déjà en cours" state.
struct SyncGuard;

impl SyncGuard {
    /// Acquire the process-wide lock, or report that a cycle is already running.
    fn acquire() -> AppResult<Self> {
        // `compare_exchange` is the atomic test-and-set: only the thread that
        // flips false→true wins; every concurrent caller gets the Err arm.
        if SYNC_IN_FLIGHT
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return Err(AppError::Validation(
                "Une synchronisation est déjà en cours. Réessaie dans un instant.".into(),
            ));
        }
        Ok(Self)
    }
}

impl Drop for SyncGuard {
    fn drop(&mut self) {
        SYNC_IN_FLIGHT.store(false, Ordering::Release);
    }
}

/// One end-to-end sync cycle for a configured + logged-in user.
///
/// Pipeline:
///   1. Read the current cursor from `sync_state`.
///   2. Snapshot the new cursor (`finished_at`) BEFORE extraction (P050).
///   3. Extract local deltas (decks, notes, cards, reviews).
///   4. Push them to Supabase (the client returns empty payloads until the
///      project is live, which is fine — we just go through the motions).
///   5. Pull remote deltas with the same cursor.
///   6. Apply them in a single SQLite transaction.
///   7. Bump `sync_state.last_sync_at` to the cursor snapshot.
pub async fn run_cycle(
    db: &Database,
    config: &SupabaseConfig,
    session: &SyncSession,
) -> AppResult<SyncReport> {
    // P051 — take the process-wide lock first. Held for the whole cycle (the
    // guard drops at function end / on any `?` early-return), so a concurrent
    // caller gets « déjà en cours » instead of a nested-transaction crash.
    let _sync_guard = SyncGuard::acquire()?;

    // ---- 1. read cursor -----------------------------------------------------
    let since: i64 = {
        let conn = db.lock();
        conn.query_row(
            "SELECT COALESCE(last_sync_at, 0) FROM sync_state WHERE id = 1",
            [],
            |row| row.get(0),
        )?
    };

    // P050 — snapshot the next cursor BEFORE extraction, not after the network
    // I/O. The old code stamped `finished_at = now()` once push/pull had
    // returned, so any local edit committed during that window carried an
    // `updated_at` inside `(extraction, finished_at)`: it was missed this cycle
    // (extracted with the *old* `since`) AND lost forever next cycle, because
    // `updated_at > since` would be false once `since == finished_at`. Taking
    // the snapshot up front guarantees `finished_at <= updated_at` for every
    // such concurrent edit, so the next cycle re-extracts it (re-pushing an
    // already-synced row is idempotent under LWW).
    let finished_at = Utc::now().timestamp();

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
    // `finished_at` was snapshotted up front (P050).
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
