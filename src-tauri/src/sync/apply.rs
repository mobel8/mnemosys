//! Apply remote changesets to the local database.
//!
//! The merge policy is **Last-Write-Wins on `updated_at`**:
//!
//! - Remote row newer than local → replace local fields.
//! - Remote row older than local → ignore (the next push will inform the
//!   server that we hold a newer copy).
//! - Equal timestamps → keep local (deterministic tie-break).
//! - Remote `deleted_at > local.updated_at` → delete the local row.
//!
//! Reviews are append-only; we union by `(card_id, reviewed_at)` so a
//! replay never duplicates a row.
//!
//! Every function here works on a borrowed connection — the orchestrator
//! wraps the whole apply phase in a single SQLite transaction so a crash
//! mid-merge does not leave the DB in a partial state.

use rusqlite::{params, Connection, OptionalExtension};

use crate::error::AppResult;

use super::client::{RemoteCard, RemoteDeck, RemoteNote, RemoteReview};

/// Outcome reported back to the orchestrator. Used by [`apply_decks`],
/// [`apply_notes`] and [`apply_cards`] so the caller can build a
/// [`super::SyncReport`].
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct MergeStats {
    pub inserted: usize,
    pub updated: usize,
    pub deleted: usize,
    pub skipped: usize,
}

impl MergeStats {
    /// Total rows touched (insert + update + delete). The UI counts this as
    /// « received » in the sync toast.
    pub fn touched(&self) -> usize {
        self.inserted + self.updated + self.deleted
    }
}

/// LWW decision over a `(remote_updated_at, local_updated_at)` pair. Pulled
/// out as a free function so the unit tests don't need a SQLite handle.
pub fn lww_should_replace(remote_updated_at: i64, local_updated_at: i64) -> bool {
    remote_updated_at > local_updated_at
}

/// P089 — bring a remote `desired_retention` into the valid `[0.5, 0.99]`
/// window before it touches the DB.
///
/// The bound is enforced in Rust on the local create/update paths
/// (`DeckRepo::create` / `update`), but `apply_decks` writes the value straight
/// from the remote payload, bypassing that check. A malicious or buggy peer
/// could ship `0.0`, `1.5` or `NaN`, which FSRS turns into absurd intervals (a
/// `NaN` retention poisons every subsequent scheduling computation for the
/// deck). `NaN` is mapped to the default `0.9` (it compares false to every
/// bound, so a plain clamp would leave it untouched); finite values are clamped
/// to the nearest legal bound. The DB-level CHECK in `schema.sql` is the
/// belt-and-braces backstop for any future write path.
fn sanitize_desired_retention(value: f64) -> f64 {
    if value.is_nan() {
        return 0.9;
    }
    value.clamp(0.5, 0.99)
}

/// Apply a remote deck batch to the local DB.
///
/// Algorithm per row:
///   1. Look up the local row by `remote_id`.
///   2. Tombstone path → delete and continue.
///   3. Local missing → INSERT a new row with the remote UUID.
///   4. Local present → LWW merge.
pub fn apply_decks(conn: &Connection, remote: &[RemoteDeck]) -> AppResult<MergeStats> {
    let mut stats = MergeStats::default();
    for r in remote {
        if r.id.is_empty() {
            stats.skipped += 1;
            continue;
        }
        let local: Option<(i64, i64)> = conn
            .query_row(
                "SELECT id, updated_at FROM decks WHERE remote_id = ?1",
                params![r.id],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
            )
            .optional()?;

        match (r.deleted_at, local) {
            (Some(tomb_at), Some((local_id, local_updated))) => {
                if tomb_at > local_updated {
                    conn.execute("DELETE FROM decks WHERE id = ?1", params![local_id])?;
                    stats.deleted += 1;
                } else {
                    stats.skipped += 1;
                }
            }
            (Some(_), None) => {
                // Server-side delete for something we never had. Nothing to do.
                stats.skipped += 1;
            }
            (None, None) => {
                // P089 — never persist a remote retention outside [0.5, 0.99].
                let retention = sanitize_desired_retention(r.desired_retention);
                conn.execute(
                    "INSERT INTO decks (name, description, color, desired_retention,
                                        created_at, updated_at, remote_id)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![
                        r.name,
                        r.description,
                        r.color,
                        retention,
                        r.created_at,
                        r.updated_at,
                        r.id
                    ],
                )?;
                stats.inserted += 1;
            }
            (None, Some((local_id, local_updated))) => {
                if lww_should_replace(r.updated_at, local_updated) {
                    // P089 — same clamp on the update path.
                    let retention = sanitize_desired_retention(r.desired_retention);
                    conn.execute(
                        "UPDATE decks SET name = ?1, description = ?2, color = ?3,
                                          desired_retention = ?4, updated_at = ?5
                         WHERE id = ?6",
                        params![
                            r.name,
                            r.description,
                            r.color,
                            retention,
                            r.updated_at,
                            local_id
                        ],
                    )?;
                    stats.updated += 1;
                } else {
                    stats.skipped += 1;
                }
            }
        }
    }
    Ok(stats)
}

/// Apply a remote note batch. Notes target their deck via the parent's
/// remote UUID; rows whose parent is unknown locally are skipped (the
/// orchestrator will retry on the next cycle, by which point the deck push
/// will have populated the missing parent).
pub fn apply_notes(conn: &Connection, remote: &[RemoteNote]) -> AppResult<MergeStats> {
    let mut stats = MergeStats::default();
    for r in remote {
        if r.id.is_empty() {
            stats.skipped += 1;
            continue;
        }
        let parent_deck: Option<i64> = conn
            .query_row(
                "SELECT id FROM decks WHERE remote_id = ?1",
                params![r.deck_id],
                |row| row.get(0),
            )
            .optional()?;
        let parent_deck = match parent_deck {
            Some(id) => id,
            None => {
                stats.skipped += 1;
                continue;
            }
        };

        let local: Option<(i64, i64)> = conn
            .query_row(
                "SELECT id, updated_at FROM notes WHERE remote_id = ?1",
                params![r.id],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
            )
            .optional()?;

        match (r.deleted_at, local) {
            (Some(tomb_at), Some((local_id, local_updated))) => {
                if tomb_at > local_updated {
                    conn.execute("DELETE FROM notes WHERE id = ?1", params![local_id])?;
                    stats.deleted += 1;
                } else {
                    stats.skipped += 1;
                }
            }
            (Some(_), None) => stats.skipped += 1,
            (None, None) => {
                let fields_json = serde_json::to_string(&r.fields)?;
                let tags_json = serde_json::to_string(&r.tags)?;
                conn.execute(
                    "INSERT INTO notes (deck_id, template, fields, tags,
                                        created_at, updated_at, remote_id)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![
                        parent_deck,
                        r.template,
                        fields_json,
                        tags_json,
                        r.created_at,
                        r.updated_at,
                        r.id
                    ],
                )?;
                stats.inserted += 1;
            }
            (None, Some((local_id, local_updated))) => {
                if lww_should_replace(r.updated_at, local_updated) {
                    let fields_json = serde_json::to_string(&r.fields)?;
                    let tags_json = serde_json::to_string(&r.tags)?;
                    conn.execute(
                        "UPDATE notes SET fields = ?1, tags = ?2, updated_at = ?3
                         WHERE id = ?4",
                        params![fields_json, tags_json, r.updated_at, local_id],
                    )?;
                    stats.updated += 1;
                } else {
                    stats.skipped += 1;
                }
            }
        }
    }
    Ok(stats)
}

/// Apply a remote card batch. Cards depend on both `note` and `deck`, which
/// must already be present locally (the orchestrator pushes them first in
/// the same cycle).
pub fn apply_cards(conn: &Connection, remote: &[RemoteCard]) -> AppResult<MergeStats> {
    let mut stats = MergeStats::default();
    for r in remote {
        if r.id.is_empty() {
            stats.skipped += 1;
            continue;
        }
        let parent_note: Option<i64> = conn
            .query_row(
                "SELECT id FROM notes WHERE remote_id = ?1",
                params![r.note_id],
                |row| row.get(0),
            )
            .optional()?;
        let parent_deck: Option<i64> = conn
            .query_row(
                "SELECT id FROM decks WHERE remote_id = ?1",
                params![r.deck_id],
                |row| row.get(0),
            )
            .optional()?;
        let (parent_note, parent_deck) = match (parent_note, parent_deck) {
            (Some(n), Some(d)) => (n, d),
            _ => {
                stats.skipped += 1;
                continue;
            }
        };

        let local: Option<(i64, i64)> = conn
            .query_row(
                "SELECT id, updated_at FROM cards WHERE remote_id = ?1",
                params![r.id],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
            )
            .optional()?;

        match (r.deleted_at, local) {
            (Some(tomb_at), Some((local_id, local_updated))) => {
                if tomb_at > local_updated {
                    conn.execute("DELETE FROM cards WHERE id = ?1", params![local_id])?;
                    stats.deleted += 1;
                } else {
                    stats.skipped += 1;
                }
            }
            (Some(_), None) => stats.skipped += 1,
            (None, None) => {
                conn.execute(
                    "INSERT INTO cards (note_id, deck_id, card_ord, state, stability, difficulty,
                                        last_review, next_review, elapsed_days, scheduled_days,
                                        reps, lapses, suspended, created_at, updated_at, remote_id)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
                    params![
                        parent_note,
                        parent_deck,
                        r.card_ord,
                        r.state,
                        r.stability,
                        r.difficulty,
                        r.last_review,
                        r.next_review,
                        r.elapsed_days,
                        r.scheduled_days,
                        r.reps,
                        r.lapses,
                        r.suspended as i64,
                        r.created_at,
                        r.updated_at,
                        r.id
                    ],
                )?;
                stats.inserted += 1;
            }
            (None, Some((local_id, local_updated))) => {
                if lww_should_replace(r.updated_at, local_updated) {
                    conn.execute(
                        "UPDATE cards SET state = ?1, stability = ?2, difficulty = ?3,
                                          last_review = ?4, next_review = ?5,
                                          elapsed_days = ?6, scheduled_days = ?7,
                                          reps = ?8, lapses = ?9, suspended = ?10,
                                          updated_at = ?11
                         WHERE id = ?12",
                        params![
                            r.state,
                            r.stability,
                            r.difficulty,
                            r.last_review,
                            r.next_review,
                            r.elapsed_days,
                            r.scheduled_days,
                            r.reps,
                            r.lapses,
                            r.suspended as i64,
                            r.updated_at,
                            local_id
                        ],
                    )?;
                    stats.updated += 1;
                } else {
                    stats.skipped += 1;
                }
            }
        }
    }
    Ok(stats)
}

/// Reviews are append-only — fusion is union by `(card_id, reviewed_at)`.
/// A row matching both fields is skipped; everything else is inserted.
pub fn apply_reviews(conn: &Connection, remote: &[RemoteReview]) -> AppResult<MergeStats> {
    let mut stats = MergeStats::default();
    for r in remote {
        let parent_card: Option<i64> = conn
            .query_row(
                "SELECT id FROM cards WHERE remote_id = ?1",
                params![r.card_id],
                |row| row.get(0),
            )
            .optional()?;
        let parent_card = match parent_card {
            Some(id) => id,
            None => {
                stats.skipped += 1;
                continue;
            }
        };

        let already_present: Option<i64> = conn
            .query_row(
                "SELECT id FROM reviews WHERE card_id = ?1 AND reviewed_at = ?2",
                params![parent_card, r.reviewed_at],
                |row| row.get(0),
            )
            .optional()?;
        if already_present.is_some() {
            stats.skipped += 1;
            continue;
        }

        conn.execute(
            "INSERT INTO reviews (card_id, rating, state_before, state_after,
                                  stability_before, stability_after,
                                  difficulty_before, difficulty_after,
                                  elapsed_days, scheduled_days, review_time, reviewed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                parent_card,
                r.rating,
                r.state_before,
                r.state_after,
                r.stability_before,
                r.stability_after,
                r.difficulty_before,
                r.difficulty_after,
                r.elapsed_days,
                r.scheduled_days,
                r.review_time,
                r.reviewed_at
            ],
        )?;
        stats.inserted += 1;
    }
    Ok(stats)
}

/// Persist the new cursor onto the singleton `sync_state` row.
pub fn write_cursor(conn: &Connection, finished_at: i64, user_id: Option<&str>) -> AppResult<()> {
    conn.execute(
        "UPDATE sync_state SET last_sync_at = ?1, user_id = ?2 WHERE id = 1",
        params![finished_at, user_id],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// P089 — a remote retention is always brought into `[0.5, 0.99]` before it
    /// can reach the DB, and NaN falls back to the 0.9 default rather than
    /// slipping through a naive clamp (NaN compares false to every bound).
    #[test]
    fn sanitize_desired_retention_clamps_and_defaults_nan() {
        // In-range values pass through untouched.
        assert!((sanitize_desired_retention(0.9) - 0.9).abs() < 1e-9);
        assert!((sanitize_desired_retention(0.5) - 0.5).abs() < 1e-9);
        assert!((sanitize_desired_retention(0.99) - 0.99).abs() < 1e-9);
        // Out-of-range values clamp to the nearest legal bound.
        assert!((sanitize_desired_retention(0.0) - 0.5).abs() < 1e-9);
        assert!((sanitize_desired_retention(1.5) - 0.99).abs() < 1e-9);
        assert!((sanitize_desired_retention(-3.0) - 0.5).abs() < 1e-9);
        // NaN maps to the default, never persisted as NaN.
        assert!((sanitize_desired_retention(f64::NAN) - 0.9).abs() < 1e-9);
    }
}
