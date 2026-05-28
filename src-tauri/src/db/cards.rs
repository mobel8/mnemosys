//! Card repository — the actual SRS units (one row per scheduled question).
//!
//! Cards are owned by a note; depending on the note template a single note
//! produces 1, 2 or N cards (basic, basic_reverse, or cloze). Scheduling
//! columns (`stability`, `difficulty`, `next_review`, …) are nullable for
//! brand-new cards and populated by the FSRS scheduler (agent A3).

use std::str::FromStr;

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
}

impl FromStr for CardState {
    type Err = AppError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
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

    /// Reset a card to its pristine `new` state.
    ///
    /// Clears every scheduling field (`stability`, `difficulty`, `last_review`,
    /// `next_review`, `elapsed_days`, `scheduled_days`, `reps`, `lapses`) and
    /// flips `state` back to `new`. Useful when a learner wants to "forget"
    /// what FSRS knows about a card and start fresh — typically because they
    /// edited the prompt heavily or want to relearn from scratch.
    ///
    /// Does NOT touch the `reviews` history table: the journal stays intact
    /// so stats reflect the actual learning effort. If the caller wants the
    /// historical reviews gone too, they should delete the note.
    pub fn reset(&self, id: i64) -> AppResult<Card> {
        let now = Utc::now().timestamp();
        let affected = self.conn.execute(
            "UPDATE cards
             SET state = 'new',
                 stability = NULL,
                 difficulty = NULL,
                 last_review = NULL,
                 next_review = NULL,
                 elapsed_days = 0,
                 scheduled_days = 0,
                 reps = 0,
                 lapses = 0,
                 updated_at = ?1
             WHERE id = ?2",
            params![now, id],
        )?;
        if affected == 0 {
            return Err(AppError::NotFound(format!("card id={}", id)));
        }
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

    /// Multi-deck interleaved due-card queue (Vague 5 — Rohrer & Taylor 2015).
    ///
    /// Same filter as [`due_cards`] (`suspended = 0` + `next_review <= now`),
    /// but pulls from *every* deck listed in `deck_ids` and shuffles the
    /// resulting queue before truncating to `limit`. Interleaved practice
    /// boosts delayed-test retention by ~2× vs blocked practice, which is
    /// why this lives as a separate code path rather than retrofitting the
    /// existing single-deck `due_cards`.
    ///
    /// `deck_ids` must be non-empty; otherwise an empty vec is returned.
    /// Shuffling uses a stdlib-only Fisher–Yates pass seeded from the
    /// system clock — sufficiently random for human-perceived ordering
    /// without pulling the `rand` crate.
    pub fn due_cards_interleaved(
        &self,
        deck_ids: &[i64],
        now: i64,
        limit: u32,
    ) -> AppResult<Vec<CardWithNote>> {
        if deck_ids.is_empty() || limit == 0 {
            return Ok(Vec::new());
        }

        // Build a parameter placeholder list of the right length. We can't
        // bind a Vec<i64> as a single param with rusqlite's positional API,
        // so we widen the IN(...) clause to N placeholders + concatenate
        // the boxed params.
        let placeholders: String = (1..=deck_ids.len())
            .map(|i| format!("?{}", i))
            .collect::<Vec<_>>()
            .join(",");
        let now_idx = deck_ids.len() + 1;
        // We deliberately fetch more than `limit` before shuffling, then
        // truncate — otherwise SQLite's natural ordering would bias the
        // queue toward whichever deck has the smallest `next_review`.
        // 1024 is a soft ceiling that keeps the memory cost trivial even
        // for very deep multi-deck practice sessions.
        let prefetch_cap: u32 = limit.saturating_mul(4).min(1024);
        let sql = format!(
            "SELECT id, note_id, deck_id, card_ord, state, stability, difficulty,
                    last_review, next_review, elapsed_days, scheduled_days,
                    reps, lapses, suspended, created_at, updated_at
             FROM cards
             WHERE suspended = 0
               AND deck_id IN ({})
               AND next_review IS NOT NULL
               AND next_review <= ?{}
             ORDER BY next_review ASC
             LIMIT ?{}",
            placeholders,
            now_idx,
            now_idx + 1
        );

        let mut stmt = self.conn.prepare(&sql)?;
        let mut params_dyn: Vec<rusqlite::types::Value> = deck_ids
            .iter()
            .map(|d| rusqlite::types::Value::Integer(*d))
            .collect();
        params_dyn.push(rusqlite::types::Value::Integer(now));
        params_dyn.push(rusqlite::types::Value::Integer(prefetch_cap as i64));

        let rows = stmt.query_map(
            rusqlite::params_from_iter(params_dyn.iter()),
            row_to_card,
        )?;

        let mut cards = Vec::new();
        for r in rows {
            cards.push(r?);
        }

        // Fisher–Yates shuffle seeded from the system clock.
        shuffle_in_place(&mut cards);

        cards.truncate(limit as usize);

        // Resolve each parent note. Done after the truncate so we don't pay
        // the lookup cost for cards we'll throw away.
        let notes_repo = notes::NoteRepo::new(self.conn);
        let mut out = Vec::with_capacity(cards.len());
        for card in cards {
            let note = notes_repo.get(card.note_id)?;
            out.push(CardWithNote { card, note });
        }
        Ok(out)
    }
}

/// Fisher–Yates shuffle using a `SystemTime`-seeded xorshift32 PRNG.
///
/// We avoid pulling `rand` into the binary just for the interleaved-review
/// path. The seed mixes seconds + nanoseconds + the slice's length so two
/// shuffles called in quick succession on different inputs still diverge.
/// The randomness quality is **not** cryptographic, but for queue ordering
/// the human-perceived spread is what matters.
fn shuffle_in_place<T>(items: &mut [T]) {
    let len = items.len();
    if len < 2 {
        return;
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| (d.as_secs() ^ u64::from(d.subsec_nanos())) as u32)
        .unwrap_or(0xDEAD_BEEF);
    // Xor in the length so successive calls in the same nanosecond still
    // produce different sequences for differently-sized inputs.
    let mut state: u32 = now ^ (len as u32).wrapping_mul(0x9E37_79B9);
    if state == 0 {
        state = 0x1234_5678;
    }
    let mut next = || -> u32 {
        // Xorshift32 — fast, no deps, mixes well enough for our purpose.
        state ^= state << 13;
        state ^= state >> 17;
        state ^= state << 5;
        state
    };
    for i in (1..len).rev() {
        let j = (next() as usize) % (i + 1);
        items.swap(i, j);
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::notes::NoteTemplate;
    use crate::db::Database;
    use serde_json::json;

    /// A fixed "now" so the date math in these tests is deterministic.
    const NOW: i64 = 1_700_000_000;
    const DAY: i64 = 86_400;

    /// Create a deck + a basic note (which auto-mints exactly one card) and
    /// return the freshly-created card id. Keeps each test's setup to one line.
    fn seed_card(db: &Database, conn: &Connection, deck_name: &str) -> i64 {
        let deck = db
            .decks(conn)
            .create(deck_name, None, "#3b82f6", 0.9, None, None, None)
            .unwrap();
        let note = db
            .notes(conn)
            .create(
                deck.id,
                NoteTemplate::Basic,
                json!({ "front": "f", "back": "b" }),
                vec![],
                None,
            )
            .unwrap();
        conn.query_row(
            "SELECT id FROM cards WHERE note_id = ?1",
            params![note.id],
            |r| r.get(0),
        )
        .unwrap()
    }

    /// Return the `deck_id` of a card row (so we can drive the interleaved test
    /// without threading the deck ids through the helper).
    fn deck_of(conn: &Connection, card_id: i64) -> i64 {
        conn.query_row(
            "SELECT deck_id FROM cards WHERE id = ?1",
            params![card_id],
            |r| r.get(0),
        )
        .unwrap()
    }

    #[test]
    fn update_after_review_persists_scheduling_fields() {
        let db = Database::for_test();
        let conn = db.lock();
        let card_id = seed_card(&db, &conn, "D");
        let cards = db.cards(&conn);

        // A brand-new card has no scheduling yet.
        let before = cards.get(card_id).unwrap();
        assert_eq!(before.state, CardState::New);
        assert_eq!(before.reps, 0);
        assert_eq!(before.lapses, 0);
        assert!(before.next_review.is_none());

        let updated = cards
            .update_after_review(card_id, CardState::Review, 12.5, 5.0, 4, NOW)
            .unwrap();

        assert_eq!(updated.state, CardState::Review);
        assert_eq!(updated.stability, Some(12.5));
        assert_eq!(updated.difficulty, Some(5.0));
        assert_eq!(updated.scheduled_days, 4);
        assert_eq!(updated.reps, 1, "reps increment on every review");
        assert_eq!(updated.lapses, 0, "a non-relearning review never lapses");
        assert_eq!(updated.last_review, Some(NOW));
        assert_eq!(
            updated.next_review,
            Some(NOW + 4 * DAY),
            "next_review = reviewed_at + scheduled_days * 86400"
        );
    }

    #[test]
    fn update_after_review_increments_lapses_on_relearning() {
        let db = Database::for_test();
        let conn = db.lock();
        let card_id = seed_card(&db, &conn, "D");
        let cards = db.cards(&conn);

        // First a successful review, then a forget → Relearning bumps lapses.
        cards
            .update_after_review(card_id, CardState::Review, 10.0, 5.0, 6, NOW)
            .unwrap();
        let relearned = cards
            .update_after_review(card_id, CardState::Relearning, 1.0, 7.0, 0, NOW + DAY)
            .unwrap();

        assert_eq!(relearned.state, CardState::Relearning);
        assert_eq!(relearned.reps, 2);
        assert_eq!(relearned.lapses, 1, "Relearning transition records a lapse");
    }

    #[test]
    fn due_cards_returns_only_past_due_unsuspended() {
        let db = Database::for_test();
        let conn = db.lock();
        let deck = db
            .decks(&conn)
            .create("D", None, "#3b82f6", 0.9, None, None, None)
            .unwrap();
        let cards = db.cards(&conn);

        // Three cards: one due in the past, one due in the future, one due-but-
        // suspended. Only the first should surface.
        let mk = |front: &str| -> i64 {
            let note = db
                .notes(&conn)
                .create(
                    deck.id,
                    NoteTemplate::Basic,
                    json!({ "front": front, "back": "b" }),
                    vec![],
                    None,
                )
                .unwrap();
            conn.query_row(
                "SELECT id FROM cards WHERE note_id = ?1",
                params![note.id],
                |r| r.get(0),
            )
            .unwrap()
        };

        let due_id = mk("due");
        let future_id = mk("future");
        let suspended_id = mk("suspended");

        // `due` was reviewed 10 days ago with a 1-day interval → past due.
        cards
            .update_after_review(due_id, CardState::Review, 5.0, 5.0, 1, NOW - 10 * DAY)
            .unwrap();
        // `future` reviewed now with a 30-day interval → not due yet.
        cards
            .update_after_review(future_id, CardState::Review, 30.0, 5.0, 30, NOW)
            .unwrap();
        // `suspended` is past due but suspended → must be excluded.
        cards
            .update_after_review(suspended_id, CardState::Review, 5.0, 5.0, 1, NOW - 10 * DAY)
            .unwrap();
        cards.suspend(suspended_id, true).unwrap();

        let due = cards.due_cards(Some(deck.id), NOW, 50).unwrap();
        let ids: Vec<i64> = due.iter().map(|c| c.card.id).collect();
        assert_eq!(ids, vec![due_id], "only the past-due, unsuspended card is returned");

        // The count helper must agree with the list.
        assert_eq!(cards.due_cards_count(Some(deck.id), NOW).unwrap(), 1);
    }

    #[test]
    fn due_cards_interleaved_pulls_from_every_deck_and_caps_limit() {
        let db = Database::for_test();
        let conn = db.lock();

        // Two decks, two past-due cards each.
        let a1 = seed_card(&db, &conn, "A");
        let a2 = seed_card(&db, &conn, "A2");
        let deck_a = deck_of(&conn, a1);
        // Force both "A" cards onto the same deck so we genuinely test a
        // multi-card single deck alongside a second deck.
        conn.execute(
            "UPDATE cards SET deck_id = ?1 WHERE id = ?2",
            params![deck_a, a2],
        )
        .unwrap();

        let b1 = seed_card(&db, &conn, "B");
        let deck_b = deck_of(&conn, b1);

        let cards = db.cards(&conn);
        for id in [a1, a2, b1] {
            cards
                .update_after_review(id, CardState::Review, 5.0, 5.0, 1, NOW - 5 * DAY)
                .unwrap();
        }

        // All three are due across the two decks.
        let all = cards
            .due_cards_interleaved(&[deck_a, deck_b], NOW, 50)
            .unwrap();
        assert_eq!(all.len(), 3, "every past-due card across both decks is pulled");
        let decks_seen: std::collections::HashSet<i64> =
            all.iter().map(|c| c.card.deck_id).collect();
        assert!(decks_seen.contains(&deck_a) && decks_seen.contains(&deck_b));

        // The limit truncates the (shuffled) queue.
        let capped = cards
            .due_cards_interleaved(&[deck_a, deck_b], NOW, 2)
            .unwrap();
        assert_eq!(capped.len(), 2, "limit caps the returned queue");

        // Empty inputs short-circuit to an empty queue (no panic, no SQL).
        assert!(cards.due_cards_interleaved(&[], NOW, 10).unwrap().is_empty());
        assert!(cards
            .due_cards_interleaved(&[deck_a], NOW, 0)
            .unwrap()
            .is_empty());
    }
}
