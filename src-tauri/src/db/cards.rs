//! Card repository — the actual SRS units (one row per scheduled question).
//!
//! Cards are owned by a note; depending on the note template a single note
//! produces 1, 2 or N cards (basic, basic_reverse, or cloze). Scheduling
//! columns (`stability`, `difficulty`, `next_review`, …) are nullable for
//! brand-new cards and populated by the FSRS scheduler (agent A3).

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

use super::notes::{self, Note};

/// Lifecycle state used by FSRS.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CardState {
    New,
    Learning,
    Review,
    Relearning,
}

impl CardState {
    pub fn as_str(self) -> &'static str {
        match self {
            CardState::New => "new",
            CardState::Learning => "learning",
            CardState::Review => "review",
            CardState::Relearning => "relearning",
        }
    }

    pub fn from_str(s: &str) -> AppResult<Self> {
        match s {
            "new" => Ok(CardState::New),
            "learning" => Ok(CardState::Learning),
            "review" => Ok(CardState::Review),
            "relearning" => Ok(CardState::Relearning),
            other => Err(AppError::Database(format!("invalid card state '{}'", other))),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Card {
    pub id: i64,
    pub note_id: i64,
    pub deck_id: i64,
    pub card_ord: i64,
    pub state: CardState,
    pub stability: Option<f64>,
    pub difficulty: Option<f64>,
    pub last_review: Option<i64>,
    pub next_review: Option<i64>,
    pub elapsed_days: i64,
    pub scheduled_days: i64,
    pub reps: i64,
    pub lapses: i64,
    pub suspended: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Card paired with its parent note — handy for review/list UIs that need
/// to render the question content alongside scheduling metadata.
#[derive(Debug, Clone, Serialize)]
pub struct CardWithNote {
    pub card: Card,
    pub note: Note,
}

pub struct CardRepo<'a> {
    conn: &'a Connection,
}

impl<'a> CardRepo<'a> {
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }

    pub fn list_in_deck(
        &self,
        deck_id: i64,
        limit: u32,
        offset: u32,
    ) -> AppResult<Vec<CardWithNote>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, note_id, deck_id, card_ord, state, stability, difficulty,
                    last_review, next_review, elapsed_days, scheduled_days,
                    reps, lapses, suspended, created_at, updated_at
             FROM cards
             WHERE deck_id = ?1
             ORDER BY id ASC
             LIMIT ?2 OFFSET ?3",
        )?;
        let rows = stmt.query_map(params![deck_id, limit, offset], row_to_card)?;
        let mut out = Vec::new();
        let notes_repo = notes::NoteRepo::new(self.conn);
        for r in rows {
            let card = r?;
            let note = notes_repo.get(card.note_id)?;
            out.push(CardWithNote { card, note });
        }
        Ok(out)
    }

    pub fn get(&self, id: i64) -> AppResult<Card> {
        let card = self
            .conn
            .query_row(
                "SELECT id, note_id, deck_id, card_ord, state, stability, difficulty,
                        last_review, next_review, elapsed_days, scheduled_days,
                        reps, lapses, suspended, created_at, updated_at
                 FROM cards WHERE id = ?1",
                params![id],
                row_to_card,
            )
            .optional()?;
        card.ok_or_else(|| AppError::NotFound(format!("card id={}", id)))
    }

    pub fn get_with_note(&self, id: i64) -> AppResult<CardWithNote> {
        let card = self.get(id)?;
        let note = notes::NoteRepo::new(self.conn).get(card.note_id)?;
        Ok(CardWithNote { card, note })
    }

    /// Create a brand-new card for an existing note. Used by `NoteRepo::create`.
    pub fn create_for_note(
        &self,
        note_id: i64,
        deck_id: i64,
        card_ord: i64,
    ) -> AppResult<Card> {
        let now = Utc::now().timestamp();
        self.conn.execute(
            "INSERT INTO cards (note_id, deck_id, card_ord, state, created_at, updated_at)
             VALUES (?1, ?2, ?3, 'new', ?4, ?4)",
            params![note_id, deck_id, card_ord, now],
        )?;
        self.get(self.conn.last_insert_rowid())
    }

    /// Persist the result of a FSRS scheduling step.
    ///
    /// `reviewed_at` is the unix timestamp at which the user answered;
    /// `next_review` is derived as `reviewed_at + scheduled_days * 86400`.
    /// `lapses` is incremented when the new state is `Relearning` (the user
    /// forgot a previously-reviewed card).
    pub fn update_after_review(
        &self,
        id: i64,
        state: CardState,
        stability: f64,
        difficulty: f64,
        scheduled_days: i64,
        reviewed_at: i64,
    ) -> AppResult<Card> {
        let card = self.get(id)?;
        let next_review = reviewed_at + scheduled_days * 86_400;
        let new_reps = card.reps + 1;
        let new_lapses = card.lapses + if matches!(state, CardState::Relearning) { 1 } else { 0 };
        let elapsed = card
            .last_review
            .map(|prev| (reviewed_at - prev).max(0) / 86_400)
            .unwrap_or(0);
        let now = Utc::now().timestamp();

        self.conn.execute(
            "UPDATE cards
             SET state = ?1,
                 stability = ?2,
                 difficulty = ?3,
                 last_review = ?4,
                 next_review = ?5,
                 elapsed_days = ?6,
                 scheduled_days = ?7,
                 reps = ?8,
                 lapses = ?9,
                 updated_at = ?10
             WHERE id = ?11",
            params![
                state.as_str(),
                stability,
                difficulty,
                reviewed_at,
                next_review,
                elapsed,
                scheduled_days,
                new_reps,
                new_lapses,
                now,
                id,
            ],
        )?;
        self.get(id)
    }

    pub fn suspend(&self, id: i64, suspended: bool) -> AppResult<()> {
        let now = Utc::now().timestamp();
        let affected = self.conn.execute(
            "UPDATE cards SET suspended = ?1, updated_at = ?2 WHERE id = ?3",
            params![suspended as i64, now, id],
        )?;
        if affected == 0 {
            return Err(AppError::NotFound(format!("card id={}", id)));
        }
        Ok(())
    }

    pub fn delete(&self, id: i64) -> AppResult<()> {
        let affected = self
            .conn
            .execute("DELETE FROM cards WHERE id = ?1", params![id])?;
        if affected == 0 {
            return Err(AppError::NotFound(format!("card id={}", id)));
        }
        Ok(())
    }

    /// Cards whose `next_review` is in the past (or now), optionally restricted
    /// to one deck. `New` cards (next_review IS NULL) are not returned by this
    /// query — they're surfaced through `new_cards_count` and the session
    /// scheduler picks them up explicitly.
    pub fn due_cards(
        &self,
        deck_id: Option<i64>,
        now: i64,
        limit: u32,
    ) -> AppResult<Vec<CardWithNote>> {
        let mut out = Vec::new();
        let notes_repo = notes::NoteRepo::new(self.conn);

        match deck_id {
            Some(d) => {
                let mut stmt = self.conn.prepare(
                    "SELECT id, note_id, deck_id, card_ord, state, stability, difficulty,
                            last_review, next_review, elapsed_days, scheduled_days,
                            reps, lapses, suspended, created_at, updated_at
                     FROM cards
                     WHERE suspended = 0
                       AND deck_id = ?1
                       AND next_review IS NOT NULL
                       AND next_review <= ?2
                     ORDER BY next_review ASC
                     LIMIT ?3",
                )?;
                let rows = stmt.query_map(params![d, now, limit], row_to_card)?;
                for r in rows {
                    let card = r?;
                    let note = notes_repo.get(card.note_id)?;
                    out.push(CardWithNote { card, note });
                }
            }
            None => {
                let mut stmt = self.conn.prepare(
                    "SELECT id, note_id, deck_id, card_ord, state, stability, difficulty,
                            last_review, next_review, elapsed_days, scheduled_days,
                            reps, lapses, suspended, created_at, updated_at
                     FROM cards
                     WHERE suspended = 0
                       AND next_review IS NOT NULL
                       AND next_review <= ?1
                     ORDER BY next_review ASC
                     LIMIT ?2",
                )?;
                let rows = stmt.query_map(params![now, limit], row_to_card)?;
                for r in rows {
                    let card = r?;
                    let note = notes_repo.get(card.note_id)?;
                    out.push(CardWithNote { card, note });
                }
            }
        }
        Ok(out)
    }

    pub fn new_cards_count(&self, deck_id: i64) -> AppResult<i64> {
        let n: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM cards
             WHERE deck_id = ?1 AND state = 'new' AND suspended = 0",
            params![deck_id],
            |r| r.get(0),
        )?;
        Ok(n)
    }

    pub fn due_cards_count(&self, deck_id: Option<i64>, now: i64) -> AppResult<i64> {
        let n: i64 = match deck_id {
            Some(d) => self.conn.query_row(
                "SELECT COUNT(*) FROM cards
                 WHERE suspended = 0 AND deck_id = ?1
                   AND next_review IS NOT NULL AND next_review <= ?2",
                params![d, now],
                |r| r.get(0),
            )?,
            None => self.conn.query_row(
                "SELECT COUNT(*) FROM cards
                 WHERE suspended = 0
                   AND next_review IS NOT NULL AND next_review <= ?1",
                params![now],
                |r| r.get(0),
            )?,
        };
        Ok(n)
    }
}

fn row_to_card(row: &Row<'_>) -> rusqlite::Result<Card> {
    let state_str: String = row.get(4)?;
    let state = CardState::from_str(&state_str)
        .map_err(|e| rusqlite::Error::FromSqlConversionFailure(4, rusqlite::types::Type::Text, Box::new(std::io::Error::other(e.to_string()))))?;
    let suspended_int: i64 = row.get(13)?;
    Ok(Card {
        id: row.get(0)?,
        note_id: row.get(1)?,
        deck_id: row.get(2)?,
        card_ord: row.get(3)?,
        state,
        stability: row.get(5)?,
        difficulty: row.get(6)?,
        last_review: row.get(7)?,
        next_review: row.get(8)?,
        elapsed_days: row.get(9)?,
        scheduled_days: row.get(10)?,
        reps: row.get(11)?,
        lapses: row.get(12)?,
        suspended: suspended_int != 0,
        created_at: row.get(14)?,
        updated_at: row.get(15)?,
    })
}
