//! Review log repository.
//!
//! Every grade the user submits is appended here verbatim, both for stats
//! and to feed the future FSRS optimizer (agent A3). The log is **append-only**
//! by convention — there's no `update` method.

use std::str::FromStr;

use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};

use crate::error::AppResult;

use super::cards::CardState;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Review {
    pub id: i64,
    pub card_id: i64,
    pub rating: i64,
    pub state_before: CardState,
    pub state_after: CardState,
    pub stability_before: Option<f64>,
    pub stability_after: f64,
    pub difficulty_before: Option<f64>,
    pub difficulty_after: f64,
    pub elapsed_days: i64,
    pub scheduled_days: i64,
    pub review_time: i64,
    pub reviewed_at: i64,
    /// Optional 1..=5 metacognitive confidence captured BEFORE the FSRS
    /// rating. `None` whenever the toggle is off or the row predates v5.
    pub confidence: Option<i64>,
    /// Optional 1..=5 *retrospective* confidence captured AFTER the answer is
    /// revealed (Vague 15, Bang & Fleming 2018 — two-step confidence). `None`
    /// whenever the toggle is off or the row predates v13.
    pub confidence_post: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct NewReview {
    pub card_id: i64,
    pub rating: i64,
    pub state_before: CardState,
    pub state_after: CardState,
    pub stability_before: Option<f64>,
    pub stability_after: f64,
    pub difficulty_before: Option<f64>,
    pub difficulty_after: f64,
    pub elapsed_days: i64,
    pub scheduled_days: i64,
    pub review_time: i64,
    /// See [`Review::confidence`]. Validation of `[1, 5]` happens at the
    /// command layer before reaching this struct.
    #[serde(default)]
    pub confidence: Option<i64>,
    /// See [`Review::confidence_post`]. Validation of `[1, 5]` happens at the
    /// command layer before reaching this struct.
    #[serde(default)]
    pub confidence_post: Option<i64>,
}

/// Per-day aggregate used by the stats dashboard.
#[derive(Debug, Clone, Serialize)]
pub struct DayCount {
    pub date: String,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct DayRetention {
    pub date: String,
    pub total: i64,
    pub correct: i64,
    /// Fraction in `[0, 1]`; `0.0` when `total = 0`.
    pub rate: f64,
}

pub struct ReviewRepo<'a> {
    conn: &'a Connection,
}

impl<'a> ReviewRepo<'a> {
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }

    pub fn insert(&self, r: NewReview, reviewed_at: i64) -> AppResult<Review> {
        self.conn.execute(
            "INSERT INTO reviews (
                card_id, rating, state_before, state_after,
                stability_before, stability_after,
                difficulty_before, difficulty_after,
                elapsed_days, scheduled_days, review_time, reviewed_at,
                confidence, confidence_post
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            params![
                r.card_id,
                r.rating,
                r.state_before.as_str(),
                r.state_after.as_str(),
                r.stability_before,
                r.stability_after,
                r.difficulty_before,
                r.difficulty_after,
                r.elapsed_days,
                r.scheduled_days,
                r.review_time,
                reviewed_at,
                r.confidence,
                r.confidence_post,
            ],
        )?;
        let id = self.conn.last_insert_rowid();
        self.get(id)
    }

    fn get(&self, id: i64) -> AppResult<Review> {
        let r: AppResult<Review> = self.conn.query_row(
            "SELECT id, card_id, rating, state_before, state_after,
                    stability_before, stability_after,
                    difficulty_before, difficulty_after,
                    elapsed_days, scheduled_days, review_time, reviewed_at,
                    confidence, confidence_post
             FROM reviews WHERE id = ?1",
            params![id],
            row_to_review,
        )?;
        r
    }

    pub fn list_for_card(&self, card_id: i64) -> AppResult<Vec<Review>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, card_id, rating, state_before, state_after,
                    stability_before, stability_after,
                    difficulty_before, difficulty_after,
                    elapsed_days, scheduled_days, review_time, reviewed_at,
                    confidence, confidence_post
             FROM reviews
             WHERE card_id = ?1
             ORDER BY reviewed_at ASC",
        )?;
        let rows = stmt.query_map(params![card_id], row_to_review)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r??);
        }
        Ok(out)
    }

    /// Count of reviews per local UTC day for the last `days` days
    /// (inclusive of today). Dates are formatted `YYYY-MM-DD`.
    pub fn reviews_by_day(&self, days: u32, now: i64) -> AppResult<Vec<DayCount>> {
        let since = now - (days as i64) * 86_400;
        let mut stmt = self.conn.prepare(
            "SELECT strftime('%Y-%m-%d', reviewed_at, 'unixepoch') AS day,
                    COUNT(*) AS n
             FROM reviews
             WHERE reviewed_at >= ?1
             GROUP BY day
             ORDER BY day ASC",
        )?;
        let rows = stmt.query_map(params![since], |row| {
            Ok(DayCount {
                date: row.get(0)?,
                count: row.get(1)?,
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    /// Per-day retention rate (rating >= 3 counts as correct, ie. "Good" or "Easy").
    pub fn retention_by_day(&self, days: u32, now: i64) -> AppResult<Vec<DayRetention>> {
        let since = now - (days as i64) * 86_400;
        let mut stmt = self.conn.prepare(
            "SELECT strftime('%Y-%m-%d', reviewed_at, 'unixepoch') AS day,
                    COUNT(*) AS total,
                    SUM(CASE WHEN rating >= 3 THEN 1 ELSE 0 END) AS correct
             FROM reviews
             WHERE reviewed_at >= ?1
             GROUP BY day
             ORDER BY day ASC",
        )?;
        let rows = stmt.query_map(params![since], |row| {
            let date: String = row.get(0)?;
            let total: i64 = row.get(1)?;
            let correct: i64 = row.get(2).unwrap_or(0);
            let rate = if total > 0 {
                correct as f64 / total as f64
            } else {
                0.0
            };
            Ok(DayRetention {
                date,
                total,
                correct,
                rate,
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }
}

fn row_to_review(row: &Row<'_>) -> rusqlite::Result<AppResult<Review>> {
    let id: i64 = row.get(0)?;
    let card_id: i64 = row.get(1)?;
    let rating: i64 = row.get(2)?;
    let state_before_str: String = row.get(3)?;
    let state_after_str: String = row.get(4)?;
    let stability_before: Option<f64> = row.get(5)?;
    let stability_after: f64 = row.get(6)?;
    let difficulty_before: Option<f64> = row.get(7)?;
    let difficulty_after: f64 = row.get(8)?;
    let elapsed_days: i64 = row.get(9)?;
    let scheduled_days: i64 = row.get(10)?;
    let review_time: i64 = row.get(11)?;
    let reviewed_at: i64 = row.get(12)?;
    let confidence: Option<i64> = row.get(13)?;
    let confidence_post: Option<i64> = row.get(14)?;

    let parsed: AppResult<Review> = (|| {
        Ok(Review {
            id,
            card_id,
            rating,
            state_before: CardState::from_str(&state_before_str)?,
            state_after: CardState::from_str(&state_after_str)?,
            stability_before,
            stability_after,
            difficulty_before,
            difficulty_after,
            elapsed_days,
            scheduled_days,
            review_time,
            reviewed_at,
            confidence,
            confidence_post,
        })
    })();

    Ok(parsed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::notes::NoteTemplate;
    use crate::db::Database;
    use serde_json::json;

    /// Vague 15 — a review captures BOTH the prospective `confidence` (v5) and
    /// the retrospective `confidence_post` (v15), and they round-trip intact.
    #[test]
    fn review_persists_both_confidence_values() {
        let db = Database::for_test();
        let conn = db.lock();
        let deck = db
            .decks(&conn)
            .create("D", None, "#3b82f6", 0.9, None, None, None)
            .unwrap();
        let note = db
            .notes(&conn)
            .create(
                deck.id,
                NoteTemplate::Basic,
                json!({ "front": "f", "back": "b" }),
                vec![],
                None,
            )
            .unwrap();
        let card_id: i64 = conn
            .query_row(
                "SELECT id FROM cards WHERE note_id = ?1",
                params![note.id],
                |r| r.get(0),
            )
            .unwrap();

        let inserted = db
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
                    confidence: Some(2),
                    confidence_post: Some(4),
                },
                1_700_000_000,
            )
            .unwrap();

        assert_eq!(inserted.confidence, Some(2));
        assert_eq!(inserted.confidence_post, Some(4));

        // Re-read via list_for_card to prove the SELECT path also carries it.
        let fetched = db.reviews(&conn).list_for_card(card_id).unwrap();
        assert_eq!(fetched.len(), 1);
        assert_eq!(fetched[0].confidence, Some(2));
        assert_eq!(fetched[0].confidence_post, Some(4));
    }

    /// A review with neither confidence value keeps both NULL (backwards-compat
    /// with sessions where both toggles are off).
    #[test]
    fn review_without_confidence_is_null() {
        let db = Database::for_test();
        let conn = db.lock();
        let deck = db
            .decks(&conn)
            .create("D", None, "#3b82f6", 0.9, None, None, None)
            .unwrap();
        let note = db
            .notes(&conn)
            .create(
                deck.id,
                NoteTemplate::Basic,
                json!({ "front": "f", "back": "b" }),
                vec![],
                None,
            )
            .unwrap();
        let card_id: i64 = conn
            .query_row(
                "SELECT id FROM cards WHERE note_id = ?1",
                params![note.id],
                |r| r.get(0),
            )
            .unwrap();

        let inserted = db
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
                    confidence_post: None,
                },
                1_700_000_000,
            )
            .unwrap();
        assert!(inserted.confidence.is_none());
        assert!(inserted.confidence_post.is_none());
    }
}
