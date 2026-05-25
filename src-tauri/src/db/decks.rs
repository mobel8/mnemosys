//! Deck repository — CRUD over the `decks` table plus aggregate stats.
//!
//! Decks group notes/cards. The active deck list is shown on the home page
//! and stats power the per-deck dashboard.

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

/// A deck row, fully materialised.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Deck {
    pub id: i64,
    pub name: String,
    pub description: Option<String>,
    pub color: String,
    pub desired_retention: f64,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Partial update payload. Each `Some(_)` field is written; `None` leaves the
/// existing value untouched. The double-`Option` on `description` lets the
/// caller distinguish "leave alone" (`None`) from "clear" (`Some(None)`).
#[derive(Debug, Clone, Default, Deserialize)]
pub struct DeckPatch {
    pub name: Option<String>,
    pub description: Option<Option<String>>,
    pub color: Option<String>,
    pub desired_retention: Option<f64>,
}

/// Aggregated counts used by the deck dashboard.
#[derive(Debug, Clone, Serialize)]
pub struct DeckStats {
    pub total_cards: i64,
    pub new_cards: i64,
    pub learning_cards: i64,
    pub review_cards: i64,
    pub due_today: i64,
}

/// Thin repository — holds a borrow on the active connection.
pub struct DeckRepo<'a> {
    conn: &'a Connection,
}

impl<'a> DeckRepo<'a> {
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }

    /// All decks, alphabetical by name.
    pub fn list(&self) -> AppResult<Vec<Deck>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, description, color, desired_retention, created_at, updated_at
             FROM decks
             ORDER BY name COLLATE NOCASE ASC",
        )?;
        let rows = stmt.query_map([], row_to_deck)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    /// Fetch by id, errors with `NotFound` if absent.
    pub fn get(&self, id: i64) -> AppResult<Deck> {
        let deck = self
            .conn
            .query_row(
                "SELECT id, name, description, color, desired_retention, created_at, updated_at
                 FROM decks WHERE id = ?1",
                params![id],
                row_to_deck,
            )
            .optional()?;
        deck.ok_or_else(|| AppError::NotFound(format!("deck id={}", id)))
    }

    /// Insert a new deck. `name` must be unique (DB-enforced).
    pub fn create(
        &self,
        name: &str,
        description: Option<&str>,
        color: &str,
        desired_retention: f64,
    ) -> AppResult<Deck> {
        if name.trim().is_empty() {
            return Err(AppError::Validation("deck name must not be empty".into()));
        }
        if !(0.5..=0.99).contains(&desired_retention) {
            return Err(AppError::Validation(
                "desired_retention must be in [0.5, 0.99]".into(),
            ));
        }
        let now = Utc::now().timestamp();
        self.conn.execute(
            "INSERT INTO decks (name, description, color, desired_retention, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
            params![name, description, color, desired_retention, now],
        )?;
        let id = self.conn.last_insert_rowid();
        self.get(id)
    }

    /// Apply a partial update. Returns the refreshed row.
    pub fn update(&self, id: i64, patch: DeckPatch) -> AppResult<Deck> {
        // Make sure the deck exists first — gives a nicer error than a no-op UPDATE.
        let _ = self.get(id)?;

        if let Some(retention) = patch.desired_retention {
            if !(0.5..=0.99).contains(&retention) {
                return Err(AppError::Validation(
                    "desired_retention must be in [0.5, 0.99]".into(),
                ));
            }
        }

        let now = Utc::now().timestamp();
        // Apply each field independently — simpler than building a dynamic SQL string
        // and the deck table is tiny.
        if let Some(name) = patch.name.as_ref() {
            if name.trim().is_empty() {
                return Err(AppError::Validation("deck name must not be empty".into()));
            }
            self.conn.execute(
                "UPDATE decks SET name = ?1, updated_at = ?2 WHERE id = ?3",
                params![name, now, id],
            )?;
        }
        if let Some(desc_opt) = patch.description.as_ref() {
            self.conn.execute(
                "UPDATE decks SET description = ?1, updated_at = ?2 WHERE id = ?3",
                params![desc_opt.as_deref(), now, id],
            )?;
        }
        if let Some(color) = patch.color.as_ref() {
            self.conn.execute(
                "UPDATE decks SET color = ?1, updated_at = ?2 WHERE id = ?3",
                params![color, now, id],
            )?;
        }
        if let Some(retention) = patch.desired_retention {
            self.conn.execute(
                "UPDATE decks SET desired_retention = ?1, updated_at = ?2 WHERE id = ?3",
                params![retention, now, id],
            )?;
        }
        self.get(id)
    }

    /// Delete a deck. Notes (and their cards / reviews) cascade via FK.
    pub fn delete(&self, id: i64) -> AppResult<()> {
        let affected = self
            .conn
            .execute("DELETE FROM decks WHERE id = ?1", params![id])?;
        if affected == 0 {
            return Err(AppError::NotFound(format!("deck id={}", id)));
        }
        Ok(())
    }

    /// Count of decks (cheap; used by onboarding / empty state).
    pub fn count(&self) -> AppResult<i64> {
        let n: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM decks", [], |r| r.get(0))?;
        Ok(n)
    }

    /// Aggregate card counts for the deck dashboard.
    pub fn stats(&self, id: i64) -> AppResult<DeckStats> {
        // Confirm deck exists for a nice error.
        let _ = self.get(id)?;
        let now = Utc::now().timestamp();

        let total_cards: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM cards WHERE deck_id = ?1",
            params![id],
            |r| r.get(0),
        )?;
        let new_cards: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM cards WHERE deck_id = ?1 AND state = 'new' AND suspended = 0",
            params![id],
            |r| r.get(0),
        )?;
        let learning_cards: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM cards
             WHERE deck_id = ?1 AND state IN ('learning', 'relearning') AND suspended = 0",
            params![id],
            |r| r.get(0),
        )?;
        let review_cards: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM cards WHERE deck_id = ?1 AND state = 'review' AND suspended = 0",
            params![id],
            |r| r.get(0),
        )?;
        let due_today: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM cards
             WHERE deck_id = ?1 AND suspended = 0
               AND next_review IS NOT NULL AND next_review <= ?2",
            params![id, now],
            |r| r.get(0),
        )?;

        Ok(DeckStats {
            total_cards,
            new_cards,
            learning_cards,
            review_cards,
            due_today,
        })
    }
}

fn row_to_deck(row: &Row<'_>) -> rusqlite::Result<Deck> {
    Ok(Deck {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get(2)?,
        color: row.get(3)?,
        desired_retention: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}
