//! Local delta extraction.
//!
//! Given a cursor `since` (unix seconds — typically `sync_state.last_sync_at`
//! or `0` for a brand-new device), each `extract_*` function returns the
//! subset of local rows that need to be pushed:
//!
//! - Rows whose `updated_at > since` (every edit).
//! - Rows whose `remote_id IS NULL` (never synced).
//!
//! The output is in the "remote" wire shape (`RemoteDeck`, `RemoteNote`,
//! `RemoteCard`, `RemoteReview`). Rows that have never been synced carry an
//! empty `id` — the server assigns a UUID and echoes it back; the
//! orchestrator then persists it via [`crate::sync::apply`].
//!
//! Everything in this module is pure SQL over a borrowed connection — no
//! HTTP, no async — which is exactly what the unit tests exercise.

use rusqlite::{params, Connection};

use crate::error::AppResult;

use super::client::{RemoteCard, RemoteDeck, RemoteNote, RemoteReview};

/// Decks whose local mirror has diverged from the last sync cursor.
///
/// The `remote_id` column may be NULL (never pushed) or set (already known
/// to the server). We expose it as `String::new()` when NULL so the
/// orchestrator can identify rows in need of an assignment without
/// reshuffling types.
pub fn extract_decks(conn: &Connection, since: i64) -> AppResult<Vec<RemoteDeck>> {
    let mut stmt = conn.prepare(
        "SELECT remote_id, name, description, color, desired_retention, created_at, updated_at
         FROM decks
         WHERE updated_at > ?1 OR remote_id IS NULL
         ORDER BY updated_at ASC",
    )?;
    let rows = stmt.query_map(params![since], |row| {
        Ok(RemoteDeck {
            id: row.get::<_, Option<String>>(0)?.unwrap_or_default(),
            name: row.get(1)?,
            description: row.get(2)?,
            color: row.get(3)?,
            desired_retention: row.get(4)?,
            created_at: row.get(5)?,
            updated_at: row.get(6)?,
            // Tombstones are produced when a row is deleted locally — but
            // local deletes cascade rows out of SQLite, so we never observe
            // them here. The orchestrator tracks deletions in a separate
            // tombstone table (deferred to S4); for now, every emitted row
            // is alive.
            deleted_at: None,
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

pub fn extract_notes(conn: &Connection, since: i64) -> AppResult<Vec<RemoteNote>> {
    let mut stmt = conn.prepare(
        "SELECT n.remote_id, d.remote_id, n.template, n.fields, n.tags, n.created_at, n.updated_at
         FROM notes n
         JOIN decks d ON d.id = n.deck_id
         WHERE n.updated_at > ?1 OR n.remote_id IS NULL
         ORDER BY n.updated_at ASC",
    )?;
    let rows = stmt.query_map(params![since], |row| {
        let fields_str: String = row.get(3)?;
        let tags_str: String = row.get(4)?;
        let fields: serde_json::Value =
            serde_json::from_str(&fields_str).unwrap_or(serde_json::Value::Null);
        let tags: Vec<String> = serde_json::from_str(&tags_str).unwrap_or_default();
        Ok(RemoteNote {
            id: row.get::<_, Option<String>>(0)?.unwrap_or_default(),
            // `deck_id` here is the parent deck's `remote_id`; an unsynced
            // parent yields an empty string, which the orchestrator catches
            // before pushing (parent must be uploaded first).
            deck_id: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
            template: row.get(2)?,
            fields,
            tags,
            created_at: row.get(5)?,
            updated_at: row.get(6)?,
            deleted_at: None,
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

pub fn extract_cards(conn: &Connection, since: i64) -> AppResult<Vec<RemoteCard>> {
    let mut stmt = conn.prepare(
        "SELECT c.remote_id, n.remote_id, d.remote_id, c.card_ord, c.state,
                c.stability, c.difficulty, c.last_review, c.next_review,
                c.elapsed_days, c.scheduled_days, c.reps, c.lapses, c.suspended,
                c.created_at, c.updated_at
         FROM cards c
         JOIN notes n ON n.id = c.note_id
         JOIN decks d ON d.id = c.deck_id
         WHERE c.updated_at > ?1 OR c.remote_id IS NULL
         ORDER BY c.updated_at ASC",
    )?;
    let rows = stmt.query_map(params![since], |row| {
        Ok(RemoteCard {
            id: row.get::<_, Option<String>>(0)?.unwrap_or_default(),
            note_id: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
            deck_id: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
            card_ord: row.get(3)?,
            state: row.get(4)?,
            stability: row.get(5)?,
            difficulty: row.get(6)?,
            last_review: row.get(7)?,
            next_review: row.get(8)?,
            elapsed_days: row.get(9)?,
            scheduled_days: row.get(10)?,
            reps: row.get(11)?,
            lapses: row.get(12)?,
            suspended: row.get::<_, i64>(13)? != 0,
            created_at: row.get(14)?,
            updated_at: row.get(15)?,
            deleted_at: None,
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

/// Reviews are append-only, so the cursor is `reviewed_at` instead of
/// `updated_at`. Local rows that lack a `card.remote_id` are skipped — they
/// would dangle on the server. The orchestrator pushes cards first to make
/// sure the FK target exists, then reviews.
pub fn extract_reviews(conn: &Connection, since: i64) -> AppResult<Vec<RemoteReview>> {
    let mut stmt = conn.prepare(
        "SELECT c.remote_id, r.rating, r.state_before, r.state_after,
                r.stability_before, r.stability_after,
                r.difficulty_before, r.difficulty_after,
                r.elapsed_days, r.scheduled_days, r.review_time, r.reviewed_at
         FROM reviews r
         JOIN cards c ON c.id = r.card_id
         WHERE r.reviewed_at > ?1 AND c.remote_id IS NOT NULL
         ORDER BY r.reviewed_at ASC",
    )?;
    let rows = stmt.query_map(params![since], |row| {
        Ok(RemoteReview {
            // Reviews have no local UUID yet (they are append-only on the
            // server; an empty string tells PostgREST to assign one).
            id: String::new(),
            card_id: row.get::<_, String>(0)?,
            rating: row.get(1)?,
            state_before: row.get(2)?,
            state_after: row.get(3)?,
            stability_before: row.get(4)?,
            stability_after: row.get(5)?,
            difficulty_before: row.get(6)?,
            difficulty_after: row.get(7)?,
            elapsed_days: row.get(8)?,
            scheduled_days: row.get(9)?,
            review_time: row.get(10)?,
            reviewed_at: row.get(11)?,
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}
