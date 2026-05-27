//! Sketch repository — drawing-effect captures (Vague 7).
//!
//! One row per review where the learner submitted a sketch on the question
//! face. `sketch_data` is the PNG payload as a `data:image/png;base64,…`
//! URL so the React canvas can round-trip it verbatim via the same
//! `toDataURL()` / `<img src>` channel. For an MVP a small (≤ 50 KB) PNG
//! lives perfectly fine inside SQLite; the parent table key
//! (`review_id`) cascades on review deletion so we never leak orphans.

use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};

use crate::error::AppResult;

/// One persisted sketch. Mirrors `review_sketches` 1-1.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Sketch {
    /// The `reviews.id` this sketch is attached to (primary key here too).
    pub review_id: i64,
    pub card_id: i64,
    /// Full PNG `data:` URL, base64-encoded.
    pub sketch_data: String,
    pub created_at: i64,
}

pub struct SketchRepo<'a> {
    conn: &'a Connection,
}

impl<'a> SketchRepo<'a> {
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }

    /// Persist a sketch. Uses `INSERT OR REPLACE` so re-saving for the same
    /// `review_id` (a misbehaving UI doing two clicks) is idempotent rather
    /// than failing on the PK constraint.
    pub fn insert(
        &self,
        review_id: i64,
        card_id: i64,
        sketch_data: &str,
        created_at: i64,
    ) -> AppResult<Sketch> {
        self.conn.execute(
            "INSERT OR REPLACE INTO review_sketches (review_id, card_id, sketch_data, created_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![review_id, card_id, sketch_data, created_at],
        )?;
        Ok(Sketch {
            review_id,
            card_id,
            sketch_data: sketch_data.to_string(),
            created_at,
        })
    }

    /// Latest `limit` sketches for one card, newest first. Used by the UI's
    /// « voir mes croquis précédents » strip when a card comes back up.
    pub fn get_for_card(&self, card_id: i64, limit: u32) -> AppResult<Vec<Sketch>> {
        let mut stmt = self.conn.prepare(
            "SELECT review_id, card_id, sketch_data, created_at
             FROM review_sketches
             WHERE card_id = ?1
             ORDER BY created_at DESC
             LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![card_id, limit as i64], row_to_sketch)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    /// Wipe every sketch attached to one card. Idempotent (no error when
    /// nothing matches). Useful for « reset card » flows so a card pristine
    /// of scheduling history is also pristine of drawings.
    #[allow(dead_code)]
    pub fn delete_for_card(&self, card_id: i64) -> AppResult<usize> {
        let n = self.conn.execute(
            "DELETE FROM review_sketches WHERE card_id = ?1",
            params![card_id],
        )?;
        Ok(n)
    }
}

fn row_to_sketch(row: &Row<'_>) -> rusqlite::Result<Sketch> {
    Ok(Sketch {
        review_id: row.get(0)?,
        card_id: row.get(1)?,
        sketch_data: row.get(2)?,
        created_at: row.get(3)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::cards::CardState;
    use crate::db::notes::NoteTemplate;
    use crate::db::reviews::NewReview;
    use crate::db::Database;
    use serde_json::json;

    fn seed_card_and_review(db: &Database) -> (i64, i64) {
        let conn = db.lock();
        let deck = db
            .decks(&conn)
            .create("Default", None, "#3b82f6", 0.9, None)
            .unwrap();
        db.notes(&conn)
            .create(
                deck.id,
                NoteTemplate::Basic,
                json!({ "front": "Q", "back": "A" }),
                vec![],
            )
            .unwrap();
        let card_id = db
            .cards(&conn)
            .list_in_deck(deck.id, 10, 0)
            .unwrap()
            .pop()
            .unwrap()
            .card
            .id;
        let review = db
            .reviews(&conn)
            .insert(
                NewReview {
                    card_id,
                    rating: 3,
                    state_before: CardState::New,
                    state_after: CardState::Review,
                    stability_before: None,
                    stability_after: 5.0,
                    difficulty_before: None,
                    difficulty_after: 5.0,
                    elapsed_days: 0,
                    scheduled_days: 5,
                    review_time: 1_000,
                    confidence: None,
                },
                1_700_000_000,
            )
            .unwrap();
        (card_id, review.id)
    }

    #[test]
    fn insert_then_get_returns_one_sketch() {
        let db = Database::for_test();
        let (card_id, review_id) = seed_card_and_review(&db);
        let conn = db.lock();
        let repo = SketchRepo::new(&conn);
        let s = repo
            .insert(review_id, card_id, "data:image/png;base64,iVBOR=", 1_700_000_001)
            .unwrap();
        assert_eq!(s.card_id, card_id);
        let listed = repo.get_for_card(card_id, 5).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].sketch_data, "data:image/png;base64,iVBOR=");
    }

    #[test]
    fn delete_for_card_removes_all_sketches() {
        let db = Database::for_test();
        let (card_id, review_id) = seed_card_and_review(&db);
        let conn = db.lock();
        let repo = SketchRepo::new(&conn);
        repo.insert(review_id, card_id, "data:image/png;base64,A", 1).unwrap();
        let deleted = repo.delete_for_card(card_id).unwrap();
        assert_eq!(deleted, 1);
        assert!(repo.get_for_card(card_id, 5).unwrap().is_empty());
    }
}
