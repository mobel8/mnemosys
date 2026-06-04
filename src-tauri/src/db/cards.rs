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

use super::notes::{Note, NoteTemplate};

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
            other => Err(AppError::Database(format!(
                "invalid card state '{}'",
                other
            ))),
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
        // Single JOIN so we render the question content in one pass instead of
        // resolving each parent note with a separate query (avoids the 1+N
        // round-trips the per-card lookup used to incur — P016).
        let mut stmt = self.conn.prepare(&format!(
            "{CARD_WITH_NOTE_SELECT}
             WHERE c.deck_id = ?1
             ORDER BY c.id ASC
             LIMIT ?2 OFFSET ?3"
        ))?;
        let rows = stmt.query_map(params![deck_id, limit, offset], row_to_card_with_note)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r??);
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

    /// Fetch one card together with its parent note in a single JOIN.
    ///
    /// Used by review/palace UIs that need the question content alongside the
    /// scheduling metadata without paying a second `notes` round-trip (P016).
    pub fn get_with_note(&self, id: i64) -> AppResult<CardWithNote> {
        let row = self
            .conn
            .query_row(
                &format!("{CARD_WITH_NOTE_SELECT} WHERE c.id = ?1"),
                params![id],
                row_to_card_with_note,
            )
            .optional()?;
        match row {
            Some(Ok(cwn)) => Ok(cwn),
            Some(Err(e)) => Err(e),
            None => Err(AppError::NotFound(format!("card id={}", id))),
        }
    }

    /// Create a brand-new card for an existing note. Used by `NoteRepo::create`.
    pub fn create_for_note(&self, note_id: i64, deck_id: i64, card_ord: i64) -> AppResult<Card> {
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
    ///
    /// Convenience wrapper that loads the card first. Callers that already
    /// hold the [`Card`] (e.g. `submit_review`, which fetches it to run the
    /// scheduler) should prefer [`Self::update_after_review_with`] to avoid a
    /// redundant `SELECT` inside the review transaction (P003).
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
        self.update_after_review_with(
            &card,
            state,
            stability,
            difficulty,
            scheduled_days,
            reviewed_at,
        )
    }

    /// Same as [`Self::update_after_review`] but takes the already-loaded
    /// `card` so the caller doesn't pay a second `SELECT`. The card's
    /// `reps`, `lapses` and `last_review` are read off the passed value.
    pub fn update_after_review_with(
        &self,
        card: &Card,
        state: CardState,
        stability: f64,
        difficulty: f64,
        scheduled_days: i64,
        reviewed_at: i64,
    ) -> AppResult<Card> {
        let id = card.id;
        let next_review = reviewed_at + scheduled_days * 86_400;
        let new_reps = card.reps + 1;
        let new_lapses = card.lapses
            + if matches!(state, CardState::Relearning) {
                1
            } else {
                0
            };
        // P124: derive elapsed days through the ONE shared helper every
        // scheduler uses, so `cards.elapsed_days` can't drift from the value
        // the scheduler fed into FSRS and the one persisted on `reviews`.
        let elapsed = crate::scheduler::elapsed_days_since(card.last_review, reviewed_at);
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

    /// The review queue: scheduled-due cards **plus** brand-new cards, in one
    /// list capped at `limit`, optionally restricted to one deck.
    ///
    /// Ordering is reviews-first (the SRS convention): cards whose
    /// `next_review` has elapsed come back first (oldest due → newest), then
    /// any remaining slots are filled with `new` cards (oldest created →
    /// newest). New cards have a `NULL` `next_review` and the scheduler
    /// initialises them on the first grade — but they must still appear in the
    /// queue or a freshly-seeded deck is impossible to study (P001).
    ///
    /// `new_limit` optionally caps how many new cards may enter the queue
    /// (e.g. the learner's daily new-card budget). `None` means "no extra cap
    /// beyond the overall `limit`".
    ///
    /// Each card is paired with its parent note via a single JOIN — no per-card
    /// note lookup (P016).
    pub fn due_cards(
        &self,
        deck_id: Option<i64>,
        now: i64,
        limit: u32,
    ) -> AppResult<Vec<CardWithNote>> {
        self.due_cards_with_new(deck_id, now, limit, None)
    }

    /// Backing implementation for [`Self::due_cards`] with an explicit
    /// `new_limit`. See [`Self::due_cards`] for the ordering contract.
    pub fn due_cards_with_new(
        &self,
        deck_id: Option<i64>,
        now: i64,
        limit: u32,
        new_limit: Option<u32>,
    ) -> AppResult<Vec<CardWithNote>> {
        if limit == 0 {
            return Ok(Vec::new());
        }

        // 1) Scheduled-due cards (next_review elapsed), oldest first.
        let mut out = self.scheduled_due_cards(deck_id, now, limit)?;

        // 2) Fill any remaining capacity with brand-new cards (P001), bounded
        //    by both the leftover `limit` budget and the optional `new_limit`.
        let remaining = (limit as usize).saturating_sub(out.len());
        if remaining > 0 {
            let new_cap = match new_limit {
                Some(n) => (n as usize).min(remaining),
                None => remaining,
            };
            if new_cap > 0 {
                let new_cards = self.new_cards(deck_id, new_cap as u32)?;
                out.extend(new_cards);
            }
        }

        Ok(out)
    }

    /// Scheduled-due cards only (`next_review` elapsed) — the historical
    /// `due_cards` behaviour, kept private as the first leg of the merged
    /// queue. JOINs the parent note in one pass (P016).
    fn scheduled_due_cards(
        &self,
        deck_id: Option<i64>,
        now: i64,
        limit: u32,
    ) -> AppResult<Vec<CardWithNote>> {
        let mut out = Vec::new();
        match deck_id {
            Some(d) => {
                let mut stmt = self.conn.prepare(&format!(
                    "{CARD_WITH_NOTE_SELECT}
                     WHERE c.suspended = 0
                       AND c.deck_id = ?1
                       AND c.next_review IS NOT NULL
                       AND c.next_review <= ?2
                     ORDER BY c.next_review ASC
                     LIMIT ?3"
                ))?;
                let rows = stmt.query_map(params![d, now, limit], row_to_card_with_note)?;
                for r in rows {
                    out.push(r??);
                }
            }
            None => {
                let mut stmt = self.conn.prepare(&format!(
                    "{CARD_WITH_NOTE_SELECT}
                     WHERE c.suspended = 0
                       AND c.next_review IS NOT NULL
                       AND c.next_review <= ?1
                     ORDER BY c.next_review ASC
                     LIMIT ?2"
                ))?;
                let rows = stmt.query_map(params![now, limit], row_to_card_with_note)?;
                for r in rows {
                    out.push(r??);
                }
            }
        }
        Ok(out)
    }

    /// Brand-new (`state = 'new'`, unsuspended) cards, oldest created first,
    /// optionally restricted to one deck. Joins the parent note in one pass.
    ///
    /// These have a `NULL` `next_review`; the scheduler initialises their
    /// memory state on the first grade. Surfaced here so a freshly-seeded deck
    /// is actually studyable (P001).
    pub fn new_cards(&self, deck_id: Option<i64>, limit: u32) -> AppResult<Vec<CardWithNote>> {
        if limit == 0 {
            return Ok(Vec::new());
        }
        let mut out = Vec::new();
        match deck_id {
            Some(d) => {
                let mut stmt = self.conn.prepare(&format!(
                    "{CARD_WITH_NOTE_SELECT}
                     WHERE c.suspended = 0
                       AND c.deck_id = ?1
                       AND c.state = 'new'
                     ORDER BY c.created_at ASC, c.id ASC
                     LIMIT ?2"
                ))?;
                let rows = stmt.query_map(params![d, limit], row_to_card_with_note)?;
                for r in rows {
                    out.push(r??);
                }
            }
            None => {
                let mut stmt = self.conn.prepare(&format!(
                    "{CARD_WITH_NOTE_SELECT}
                     WHERE c.suspended = 0
                       AND c.state = 'new'
                     ORDER BY c.created_at ASC, c.id ASC
                     LIMIT ?1"
                ))?;
                let rows = stmt.query_map(params![limit], row_to_card_with_note)?;
                for r in rows {
                    out.push(r??);
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

    /// Multi-deck interleaved review queue (Vague 5 — Rohrer & Taylor 2015).
    ///
    /// Like [`due_cards`] it pulls scheduled-due cards (`suspended = 0` +
    /// `next_review <= now`) **and** brand-new cards (P001), but across *every*
    /// deck in `deck_ids`, then shuffles before truncating to `limit`.
    /// Interleaved practice boosts delayed-test retention by ~2× vs blocked
    /// practice, which is why this lives as a separate code path rather than
    /// retrofitting the single-deck `due_cards`.
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
        // Both legs (scheduled-due OR new) in one scan so a multi-deck session
        // started on a freshly-seeded deck isn't empty. `next_review` is NULL
        // for new cards, so the predicate is an explicit OR.
        let sql = format!(
            "SELECT id, note_id, deck_id, card_ord, state, stability, difficulty,
                    last_review, next_review, elapsed_days, scheduled_days,
                    reps, lapses, suspended, created_at, updated_at
             FROM cards
             WHERE suspended = 0
               AND deck_id IN ({})
               AND (
                     (next_review IS NOT NULL AND next_review <= ?{})
                  OR state = 'new'
                   )
             ORDER BY (next_review IS NULL), next_review ASC, created_at ASC
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

        let rows = stmt.query_map(rusqlite::params_from_iter(params_dyn.iter()), row_to_card)?;

        let mut cards = Vec::new();
        for r in rows {
            cards.push(r?);
        }

        // Fisher–Yates shuffle seeded from the system clock.
        shuffle_in_place(&mut cards);

        cards.truncate(limit as usize);

        // Resolve every parent note in ONE batched query (P016) instead of a
        // lookup per card. Done after the truncate so we don't pay for cards
        // we'll throw away.
        self.attach_notes(cards)
    }

    /// Pair each [`Card`] with its parent [`Note`] using a single
    /// `WHERE id IN (...)` query against `notes`, preserving the input order
    /// (P016 — no per-card round-trip). A card whose note vanished mid-flight
    /// is dropped rather than erroring the whole queue.
    fn attach_notes(&self, cards: Vec<Card>) -> AppResult<Vec<CardWithNote>> {
        if cards.is_empty() {
            return Ok(Vec::new());
        }

        // Unique note ids, preserving first-seen order is irrelevant here since
        // we index into a map afterwards.
        let mut note_ids: Vec<i64> = cards.iter().map(|c| c.note_id).collect();
        note_ids.sort_unstable();
        note_ids.dedup();

        let placeholders: String = (1..=note_ids.len())
            .map(|i| format!("?{}", i))
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!(
            "SELECT id, deck_id, template, fields, tags, created_at, updated_at, frequency_band
             FROM notes
             WHERE id IN ({})",
            placeholders
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let params_dyn: Vec<rusqlite::types::Value> = note_ids
            .iter()
            .map(|id| rusqlite::types::Value::Integer(*id))
            .collect();
        let rows = stmt.query_map(rusqlite::params_from_iter(params_dyn.iter()), row_to_note)?;

        let mut by_id: std::collections::HashMap<i64, Note> = std::collections::HashMap::new();
        for r in rows {
            let note = r??;
            by_id.insert(note.id, note);
        }

        let mut out = Vec::with_capacity(cards.len());
        for card in cards {
            if let Some(note) = by_id.get(&card.note_id) {
                out.push(CardWithNote {
                    card,
                    note: note.clone(),
                });
            }
        }
        Ok(out)
    }
}

/// SELECT prefix that JOINs `cards` (aliased `c`) to its parent `notes`
/// (aliased `n`) so one query yields a full [`CardWithNote`]. Column order is
/// the 16 card columns first, then the 8 note columns — consumed by
/// [`row_to_card_with_note`]. Callers append their own `WHERE` / `ORDER BY`.
const CARD_WITH_NOTE_SELECT: &str = "SELECT
        c.id, c.note_id, c.deck_id, c.card_ord, c.state, c.stability, c.difficulty,
        c.last_review, c.next_review, c.elapsed_days, c.scheduled_days,
        c.reps, c.lapses, c.suspended, c.created_at, c.updated_at,
        n.id, n.deck_id, n.template, n.fields, n.tags, n.created_at, n.updated_at, n.frequency_band
     FROM cards c
     JOIN notes n ON n.id = c.note_id";

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
    // P128: seed from the FULL 128-bit nanosecond clock instead of folding
    // seconds and sub-second nanos into a single u32. The old scheme discarded
    // the high bits of the second-count, and `secs ^ nanos` could collide for
    // readings a whole second apart — biasing the queue toward a handful of
    // permutations. A 64-bit splitmix64 seed mixes the length in so two calls
    // at the same instant on differently-sized inputs still diverge.
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0xDEAD_BEEF_CAFE_F00D);
    let mut state: u64 = nanos ^ (len as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15);
    if state == 0 {
        state = 0x1234_5678_9ABC_DEF0;
    }
    let mut next = || -> u64 {
        // splitmix64 — single-register PRNG with excellent avalanche; ample
        // for queue ordering and dependency-free.
        state = state.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = state;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    };
    for i in (1..len).rev() {
        let j = (next() as usize) % (i + 1);
        items.swap(i, j);
    }
}

fn row_to_card(row: &Row<'_>) -> rusqlite::Result<Card> {
    let state_str: String = row.get(4)?;
    let state = CardState::from_str(&state_str).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(
            4,
            rusqlite::types::Type::Text,
            Box::new(std::io::Error::other(e.to_string())),
        )
    })?;
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

/// Parse a [`CardWithNote`] from a row produced by [`CARD_WITH_NOTE_SELECT`]:
/// the 16 card columns (indices 0..=15) followed by the 8 note columns
/// (indices 16..=23). Note-content parsing (template / fields / tags) can fail
/// on corrupted JSON, so the inner result is surfaced as `AppResult` exactly
/// like the standalone note reader.
fn row_to_card_with_note(row: &Row<'_>) -> rusqlite::Result<AppResult<CardWithNote>> {
    let card = row_to_card(row)?;
    let note_parsed = note_from_row(row, 16);
    Ok(note_parsed.map(|note| CardWithNote { card, note }))
}

/// Parse a [`Note`] from a row whose note columns start at `base`, in the order
/// `id, deck_id, template, fields, tags, created_at, updated_at,
/// frequency_band`. Shared by [`row_to_card_with_note`] and the batched
/// note resolver. The `template`/`fields`/`tags` parsing may fail, hence the
/// `AppResult` payload.
fn row_to_note(row: &Row<'_>) -> rusqlite::Result<AppResult<Note>> {
    Ok(note_from_row(row, 0))
}

fn note_from_row(row: &Row<'_>, base: usize) -> AppResult<Note> {
    let id: i64 = row.get(base)?;
    let deck_id: i64 = row.get(base + 1)?;
    let template_str: String = row.get(base + 2)?;
    let fields_str: String = row.get(base + 3)?;
    let tags_str: String = row.get(base + 4)?;
    let created_at: i64 = row.get(base + 5)?;
    let updated_at: i64 = row.get(base + 6)?;
    let frequency_band: Option<String> = row.get(base + 7)?;

    let template = NoteTemplate::from_str(&template_str)?;
    let fields: serde_json::Value = serde_json::from_str(&fields_str)?;
    let tags: Vec<String> = serde_json::from_str(&tags_str)?;
    Ok(Note {
        id,
        deck_id,
        template,
        fields,
        tags,
        created_at,
        updated_at,
        frequency_band,
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
        assert_eq!(
            ids,
            vec![due_id],
            "only the past-due, unsuspended card is returned"
        );

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
        assert_eq!(
            all.len(),
            3,
            "every past-due card across both decks is pulled"
        );
        let decks_seen: std::collections::HashSet<i64> =
            all.iter().map(|c| c.card.deck_id).collect();
        assert!(decks_seen.contains(&deck_a) && decks_seen.contains(&deck_b));

        // The limit truncates the (shuffled) queue.
        let capped = cards
            .due_cards_interleaved(&[deck_a, deck_b], NOW, 2)
            .unwrap();
        assert_eq!(capped.len(), 2, "limit caps the returned queue");

        // Empty inputs short-circuit to an empty queue (no panic, no SQL).
        assert!(cards
            .due_cards_interleaved(&[], NOW, 10)
            .unwrap()
            .is_empty());
        assert!(cards
            .due_cards_interleaved(&[deck_a], NOW, 0)
            .unwrap()
            .is_empty());
    }

    /// P001 — brand-new cards (never reviewed, `next_review IS NULL`) MUST be
    /// surfaced by the review queue, otherwise a freshly-seeded deck is
    /// impossible to study (onboarding cracked).
    #[test]
    fn due_cards_includes_new_cards_for_a_fresh_deck() {
        let db = Database::for_test();
        let conn = db.lock();
        let deck = db
            .decks(&conn)
            .create("Fresh", None, "#3b82f6", 0.9, None, None, None)
            .unwrap();

        // Three basic notes → three brand-new cards, none reviewed yet.
        for front in ["a", "b", "c"] {
            db.notes(&conn)
                .create(
                    deck.id,
                    NoteTemplate::Basic,
                    json!({ "front": front, "back": "b" }),
                    vec![],
                    None,
                )
                .unwrap();
        }

        let cards = db.cards(&conn);
        let queue = cards.due_cards(Some(deck.id), NOW, 50).unwrap();
        assert_eq!(
            queue.len(),
            3,
            "all three new cards must appear in the review queue"
        );
        assert!(
            queue.iter().all(|c| c.card.state == CardState::New),
            "every queued card is brand-new"
        );
        // The parent note content rides along (JOIN, P016) — no empty fields.
        assert!(queue.iter().all(|c| c.note.fields.get("front").is_some()));
    }

    /// P001 — the queue is reviews-first: scheduled-due cards come before new
    /// cards, and the overall `limit` caps the merged list.
    #[test]
    fn due_cards_orders_reviews_before_new_and_caps_limit() {
        let db = Database::for_test();
        let conn = db.lock();
        let deck = db
            .decks(&conn)
            .create("Mixed", None, "#3b82f6", 0.9, None, None, None)
            .unwrap();

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
        let _new_a = mk("new_a");
        let _new_b = mk("new_b");

        // Make exactly one card past-due; the other two stay brand-new.
        db.cards(&conn)
            .update_after_review(due_id, CardState::Review, 5.0, 5.0, 1, NOW - 10 * DAY)
            .unwrap();

        let cards = db.cards(&conn);
        let queue = cards.due_cards(Some(deck.id), NOW, 50).unwrap();
        assert_eq!(queue.len(), 3, "1 due + 2 new");
        assert_eq!(
            queue[0].card.id, due_id,
            "the scheduled-due card is served before the new cards"
        );
        assert!(
            queue[1..].iter().all(|c| c.card.state == CardState::New),
            "new cards follow the due card"
        );

        // The overall limit truncates the merged queue (due card wins the slot).
        let capped = cards.due_cards(Some(deck.id), NOW, 1).unwrap();
        assert_eq!(capped.len(), 1);
        assert_eq!(capped[0].card.id, due_id);

        // An explicit new-card budget caps the new leg independently.
        let no_new = cards
            .due_cards_with_new(Some(deck.id), NOW, 50, Some(0))
            .unwrap();
        assert_eq!(no_new.len(), 1, "new_limit=0 → only the scheduled-due card");
        assert_eq!(no_new[0].card.id, due_id);
    }

    /// P001 — the interleaved multi-deck queue also surfaces new cards so a
    /// session started on a freshly-seeded deck isn't empty.
    #[test]
    fn due_cards_interleaved_includes_new_cards() {
        let db = Database::for_test();
        let conn = db.lock();

        // Deck A: one reviewed (due) card. Deck B: one brand-new card.
        let a1 = seed_card(&db, &conn, "IA");
        let deck_a = deck_of(&conn, a1);
        db.cards(&conn)
            .update_after_review(a1, CardState::Review, 5.0, 5.0, 1, NOW - 5 * DAY)
            .unwrap();

        let b1 = seed_card(&db, &conn, "IB");
        let deck_b = deck_of(&conn, b1);
        // `b1` stays brand-new (seed_card creates it as 'new').

        let cards = db.cards(&conn);
        let all = cards
            .due_cards_interleaved(&[deck_a, deck_b], NOW, 50)
            .unwrap();
        assert_eq!(
            all.len(),
            2,
            "the due card AND the brand-new card both appear"
        );
        assert!(
            all.iter().any(|c| c.card.state == CardState::New),
            "new card is included"
        );
        assert!(
            all.iter().any(|c| c.card.state == CardState::Review),
            "due card is included"
        );
    }

    /// P001 — the dedicated `new_cards` query returns only unsuspended `new`
    /// cards, oldest-created first, with the parent note joined in one pass.
    #[test]
    fn new_cards_returns_only_unsuspended_new_oldest_first() {
        let db = Database::for_test();
        let conn = db.lock();
        let deck = db
            .decks(&conn)
            .create("N", None, "#3b82f6", 0.9, None, None, None)
            .unwrap();

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

        let first = mk("first");
        let second = mk("second");
        let suspended = mk("suspended");
        db.cards(&conn).suspend(suspended, true).unwrap();

        let cards = db.cards(&conn);
        let new = cards.new_cards(Some(deck.id), 50).unwrap();
        let ids: Vec<i64> = new.iter().map(|c| c.card.id).collect();
        assert_eq!(
            ids,
            vec![first, second],
            "oldest-created new cards first; suspended excluded"
        );

        // limit = 0 short-circuits to an empty queue.
        assert!(cards.new_cards(Some(deck.id), 0).unwrap().is_empty());
    }
}
