//! Deck repository — CRUD over the `decks` table plus aggregate stats.
//!
//! Decks group notes/cards. The active deck list is shown on the home page
//! and stats power the per-deck dashboard.

use std::str::FromStr;

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::scheduler::SchedulerKind;

/// A deck row, fully materialised.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Deck {
    pub id: i64,
    pub name: String,
    pub description: Option<String>,
    pub color: String,
    pub desired_retention: f64,
    /// Algorithm used to schedule this deck's cards. Persisted as a TEXT
    /// column. Always `'fsrs6'` since migration v19 (FSRS-6 is the only
    /// scheduler); the legacy values are still parseable so pre-v19 rows can
    /// be read mid-migration. See [`crate::scheduler`] for details.
    pub scheduler_kind: SchedulerKind,
    /// Vague 10 — optional ISO 639-1 language code (`'en'`, `'ja'`, …) that
    /// flags this deck as a language-learning deck. `None` for ordinary
    /// decks. When set, the deck-detail UI surfaces the frequency-coverage
    /// card and the note editor defaults to the bidirectional template.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub language_mode: Option<String>,
    /// Vague 15 — Bloom mastery gating. When set, this deck stays "locked"
    /// (its study button disabled) until the referenced prerequisite deck is
    /// mastered (≥90 % retention over the last 30 days with ≥20 reviews).
    /// `None` for an ungated deck. See [`DeckRepo::mastery_status`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prerequisite_deck_id: Option<i64>,
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
    /// Vague 10 — set/clear the deck's language flag. The double-`Option`
    /// distinguishes "leave alone" (`None`) from "set/clear to this value"
    /// (`Some(Some("en"))` / `Some(None)`).
    pub language_mode: Option<Option<String>>,
    /// Vague 15 — set/clear the deck's mastery-gating prerequisite. Same
    /// double-`Option` convention: `None` leaves it untouched, `Some(None)`
    /// clears the gate, `Some(Some(id))` points it at another deck.
    pub prerequisite_deck_id: Option<Option<i64>>,
}

/// Aggregated counts used by the deck dashboard.
///
/// P080 — `total_cards` counts *every* card (suspended included), while
/// `new_cards` / `learning_cards` / `review_cards` only count active
/// (`suspended = 0`) cards. To keep the total decomposable, `suspended_cards`
/// is exposed as its own bucket so the UI can show
/// `total = new + learning + review + suspended` (every active card is in
/// exactly one of the three state buckets).
#[derive(Debug, Clone, Serialize)]
pub struct DeckStats {
    pub total_cards: i64,
    pub new_cards: i64,
    pub learning_cards: i64,
    pub review_cards: i64,
    /// P080 — suspended cards, the missing summand of `total_cards`.
    pub suspended_cards: i64,
    pub due_today: i64,
    /// P057 — cards the Deck Podcast can actually voice (every non-occlusion
    /// template). The UI gate uses this instead of `total_cards` so a deck of
    /// occlusion-only cards no longer offers a podcast that backend-side yields
    /// zero speakable cards.
    pub podcastable_cards: i64,
}

/// Per-deck WaniKani-style mastery distribution.
///
/// Buckets are derived from FSRS stability (a continuous proxy for memory
/// strength). Cards that have never been reviewed or are still in
/// learning/relearning all land in `apprentice` so the badge always sums to
/// the deck's total card count.
///
/// Thresholds (days of stability):
/// - `apprentice`  : new / learning / relearning OR stability < 7
/// - `guru`        : 7 <= stability < 30
/// - `master`      : 30 <= stability < 90
/// - `enlightened` : 90 <= stability < 180
/// - `burned`      : stability >= 180
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct DeckMastery {
    pub apprentice: i64,
    pub guru: i64,
    pub master: i64,
    pub enlightened: i64,
    pub burned: i64,
}

impl DeckMastery {
    pub fn total(&self) -> i64 {
        self.apprentice + self.guru + self.master + self.enlightened + self.burned
    }
}

/// P081 — one deck plus its dashboard aggregates, materialised in a single
/// query so the home grid can render `N` deck cards from one IPC round-trip
/// instead of the previous `1 + 2N..3N` (`list` + per-card `stats` +
/// `mastery`). See [`DeckRepo::list_with_stats`].
#[derive(Debug, Clone, Serialize)]
pub struct DeckWithStats {
    #[serde(flatten)]
    pub deck: Deck,
    pub stats: DeckStats,
    pub mastery: DeckMastery,
}

/// Vague 15 — Bloom mastery-learning gate status for one deck.
///
/// `mastered` is the criterion-referenced "≥90 %" rule (Bloom): the deck's
/// reviews over the last 30 days must hit a retention rate `>= 0.9` over at
/// least 20 reviews (a small floor so a single lucky review can't unlock a
/// downstream deck). `unlocked` answers "may the learner study THIS deck?":
/// `true` when there is no prerequisite, or when the prerequisite is itself
/// mastered. The remaining fields let the UI render an informative lock.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct MasteryStatus {
    /// Whether *this* deck meets the ≥90 % / ≥20-review mastery criterion.
    pub mastered: bool,
    /// Retention rate of this deck over the last 30 days, in `[0, 1]`.
    pub retention_rate: f64,
    /// Number of reviews counted toward `retention_rate` (last 30 days).
    pub review_count: i64,
    /// The prerequisite deck id, if any.
    pub prerequisite_id: Option<i64>,
    /// Whether the prerequisite (if any) is itself mastered. `false` when a
    /// prerequisite exists but isn't mastered; `true` when none exists.
    pub prerequisite_mastered: bool,
    /// Whether the learner may study this deck now (no gate, or gate cleared).
    pub unlocked: bool,
}

/// Mastery criterion constants (Bloom 1968 — 90 % mastery threshold).
const MASTERY_RETENTION_THRESHOLD: f64 = 0.9;
const MASTERY_MIN_REVIEWS: i64 = 20;
/// Window over which retention is measured for the gate (seconds in 30 days).
const MASTERY_WINDOW_SECS: i64 = 30 * 86_400;

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
            "SELECT id, name, description, color, desired_retention, scheduler_kind, language_mode, prerequisite_deck_id, created_at, updated_at
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

    /// P081 — every deck plus its dashboard aggregates (stats + mastery
    /// buckets) in a single query. Replaces the home grid's `1 + 2N..3N` IPC
    /// pattern (`list` + per-deck `stats`/`mastery`) with one round-trip.
    ///
    /// A `LEFT JOIN` keeps decks with zero cards (their aggregates are all 0
    /// via `COALESCE`), and the conditional sums mirror [`Self::stats`] /
    /// [`Self::mastery`] exactly so the batch and per-deck endpoints agree.
    pub fn list_with_stats(&self) -> AppResult<Vec<DeckWithStats>> {
        let now = Utc::now().timestamp();
        let mut stmt = self.conn.prepare(
            "SELECT
                 d.id, d.name, d.description, d.color, d.desired_retention,
                 d.scheduler_kind, d.language_mode, d.prerequisite_deck_id,
                 d.created_at, d.updated_at,
                 -- stats (cols 10..16)
                 COUNT(c.id),
                 COALESCE(SUM(CASE WHEN c.state = 'new' AND c.suspended = 0 THEN 1 ELSE 0 END), 0),
                 COALESCE(SUM(CASE WHEN c.state IN ('learning', 'relearning') AND c.suspended = 0 THEN 1 ELSE 0 END), 0),
                 COALESCE(SUM(CASE WHEN c.state = 'review' AND c.suspended = 0 THEN 1 ELSE 0 END), 0),
                 COALESCE(SUM(CASE WHEN c.suspended = 1 THEN 1 ELSE 0 END), 0),
                 COALESCE(SUM(CASE WHEN c.suspended = 0 AND c.next_review IS NOT NULL AND c.next_review <= ?1 THEN 1 ELSE 0 END), 0),
                 -- podcastable (col 16): every non-occlusion template (P057)
                 COALESCE(SUM(CASE WHEN n.template <> 'occlusion' THEN 1 ELSE 0 END), 0),
                 -- mastery (cols 17..22)
                 COALESCE(SUM(CASE WHEN c.suspended = 0 AND (c.state IN ('new', 'learning', 'relearning') OR (c.state = 'review' AND (c.stability IS NULL OR c.stability < 7.0))) THEN 1 ELSE 0 END), 0),
                 COALESCE(SUM(CASE WHEN c.suspended = 0 AND c.state = 'review' AND c.stability >= 7.0 AND c.stability < 30.0 THEN 1 ELSE 0 END), 0),
                 COALESCE(SUM(CASE WHEN c.suspended = 0 AND c.state = 'review' AND c.stability >= 30.0 AND c.stability < 90.0 THEN 1 ELSE 0 END), 0),
                 COALESCE(SUM(CASE WHEN c.suspended = 0 AND c.state = 'review' AND c.stability >= 90.0 AND c.stability < 180.0 THEN 1 ELSE 0 END), 0),
                 COALESCE(SUM(CASE WHEN c.suspended = 0 AND c.state = 'review' AND c.stability >= 180.0 THEN 1 ELSE 0 END), 0)
             FROM decks d
             LEFT JOIN cards c ON c.deck_id = d.id
             LEFT JOIN notes n ON n.id = c.note_id
             GROUP BY d.id
             ORDER BY d.name COLLATE NOCASE ASC",
        )?;
        let rows = stmt.query_map(params![now], |row| {
            let deck = row_to_deck(row)?;
            let stats = DeckStats {
                total_cards: row.get(10)?,
                new_cards: row.get(11)?,
                learning_cards: row.get(12)?,
                review_cards: row.get(13)?,
                suspended_cards: row.get(14)?,
                due_today: row.get(15)?,
                podcastable_cards: row.get(16)?,
            };
            let mastery = DeckMastery {
                apprentice: row.get(17)?,
                guru: row.get(18)?,
                master: row.get(19)?,
                enlightened: row.get(20)?,
                burned: row.get(21)?,
            };
            Ok(DeckWithStats {
                deck,
                stats,
                mastery,
            })
        })?;
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
                "SELECT id, name, description, color, desired_retention, scheduler_kind, language_mode, prerequisite_deck_id, created_at, updated_at
                 FROM decks WHERE id = ?1",
                params![id],
                row_to_deck,
            )
            .optional()?;
        deck.ok_or_else(|| AppError::NotFound(format!("deck id={}", id)))
    }

    /// Insert a new deck. `name` must be unique (DB-enforced).
    ///
    /// `_scheduler_kind` is accepted-and-ignored: FSRS-6 is the only
    /// scheduler (v0.11), so the column is always written `'fsrs6'`. The
    /// parameter slot is kept so the many existing call sites (all passing
    /// `None`) don't have to churn.
    ///
    /// `language_mode` (Vague 10) is an optional ISO 639-1 code flagging the
    /// deck as language-learning; `None` keeps it an ordinary deck.
    ///
    /// `prerequisite_deck_id` (Vague 15) optionally gates this deck behind
    /// another deck's mastery; `None` keeps it ungated.
    // One parameter per deck column; grouping them into a struct would just
    // shuffle the same fields without removing any.
    #[allow(clippy::too_many_arguments)]
    pub fn create(
        &self,
        name: &str,
        description: Option<&str>,
        color: &str,
        desired_retention: f64,
        _scheduler_kind: Option<SchedulerKind>,
        language_mode: Option<&str>,
        prerequisite_deck_id: Option<i64>,
    ) -> AppResult<Deck> {
        if name.trim().is_empty() {
            return Err(AppError::Validation("deck name must not be empty".into()));
        }
        if !(0.5..=0.99).contains(&desired_retention) {
            return Err(AppError::Validation(
                "desired_retention must be in [0.5, 0.99]".into(),
            ));
        }
        // P054: a prerequisite must point at an existing deck (a fresh deck
        // can't reference itself — it has no id yet).
        if let Some(prereq) = prerequisite_deck_id {
            if self.get(prereq).is_err() {
                return Err(AppError::Validation(
                    "Le deck prérequis spécifié n'existe pas.".into(),
                ));
            }
        }
        // FSRS-6 is the only scheduler — every new deck is 'fsrs6'.
        let kind = SchedulerKind::Fsrs6;
        let now = Utc::now().timestamp();
        self.conn.execute(
            "INSERT INTO decks (name, description, color, desired_retention, scheduler_kind, language_mode, prerequisite_deck_id, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
            params![name, description, color, desired_retention, kind.as_str(), language_mode, prerequisite_deck_id, now],
        )?;
        let id = self.conn.last_insert_rowid();
        self.get(id)
    }

    /// Apply a partial update. Returns the refreshed row.
    pub fn update(&self, id: i64, patch: DeckPatch) -> AppResult<Deck> {
        // Make sure the deck exists first — gives a nicer error than a no-op
        // UPDATE.
        let _ = self.get(id)?;

        if let Some(retention) = patch.desired_retention {
            if !(0.5..=0.99).contains(&retention) {
                return Err(AppError::Validation(
                    "desired_retention must be in [0.5, 0.99]".into(),
                ));
            }
        }

        // P054: validate the mastery-gate prerequisite before any write — reject
        // self-reference, a missing target deck, and a direct cycle (A → B where
        // B already requires A). `patch.prerequisite_deck_id` is double-wrapped:
        // `Some(None)` clears the gate, `Some(Some(p))` sets it to deck `p`.
        if let Some(Some(prereq)) = patch.prerequisite_deck_id {
            if prereq == id {
                return Err(AppError::Validation(
                    "Un deck ne peut pas être son propre prérequis.".into(),
                ));
            }
            let target = self.get(prereq).map_err(|_| {
                AppError::Validation("Le deck prérequis spécifié n'existe pas.".into())
            })?;
            if target.prerequisite_deck_id == Some(id) {
                return Err(AppError::Validation(
                    "Prérequis circulaire : le deck cible dépend déjà de ce deck.".into(),
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
        if let Some(lang_opt) = patch.language_mode.as_ref() {
            // `Some(None)` clears the flag, `Some(Some(code))` sets it.
            self.conn.execute(
                "UPDATE decks SET language_mode = ?1, updated_at = ?2 WHERE id = ?3",
                params![lang_opt.as_deref(), now, id],
            )?;
        }
        if let Some(prereq_opt) = patch.prerequisite_deck_id {
            // `Some(None)` clears the gate, `Some(Some(other_id))` sets it.
            // Guard against self-referential gates (a deck can't require
            // itself) — that would make it permanently locked.
            if prereq_opt == Some(id) {
                return Err(AppError::Validation(
                    "a deck cannot be its own prerequisite".into(),
                ));
            }
            self.conn.execute(
                "UPDATE decks SET prerequisite_deck_id = ?1, updated_at = ?2 WHERE id = ?3",
                params![prereq_opt, now, id],
            )?;
        }
        self.get(id)
    }

    /// Delete a deck.
    ///
    /// Cascades via FK (schema v17): the deck's notes — and through them their
    /// cards and reviews — are removed (`notes.deck_id` / `cards.deck_id`
    /// `ON DELETE CASCADE`). Any *other* deck that gated itself behind this one
    /// has its `prerequisite_deck_id` reset to `NULL`
    /// (`ON DELETE SET NULL`): deleting a prerequisite simply dissolves the
    /// gate instead of aborting the deletion with a constraint violation.
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
    ///
    /// P081 — a single conditional-aggregation pass over the deck's cards
    /// replaces the previous five independent `COUNT(*)` round-trips. One
    /// statement, one scan of the `idx_cards_deck` index.
    pub fn stats(&self, id: i64) -> AppResult<DeckStats> {
        // Confirm deck exists for a nice error.
        let _ = self.get(id)?;
        let now = Utc::now().timestamp();

        let stats = self.conn.query_row(
            "SELECT
                 COUNT(*),
                 SUM(CASE WHEN c.state = 'new' AND c.suspended = 0 THEN 1 ELSE 0 END),
                 SUM(CASE WHEN c.state IN ('learning', 'relearning') AND c.suspended = 0 THEN 1 ELSE 0 END),
                 SUM(CASE WHEN c.state = 'review' AND c.suspended = 0 THEN 1 ELSE 0 END),
                 SUM(CASE WHEN c.suspended = 1 THEN 1 ELSE 0 END),
                 SUM(CASE WHEN c.suspended = 0 AND c.next_review IS NOT NULL AND c.next_review <= ?2
                          THEN 1 ELSE 0 END),
                 SUM(CASE WHEN n.template <> 'occlusion' THEN 1 ELSE 0 END)
             FROM cards c
             LEFT JOIN notes n ON n.id = c.note_id
             WHERE c.deck_id = ?1",
            params![id, now],
            |r| {
                Ok(DeckStats {
                    total_cards: r.get(0)?,
                    // `SUM` is NULL when zero rows match; coalesce to 0.
                    new_cards: r.get::<_, Option<i64>>(1)?.unwrap_or(0),
                    learning_cards: r.get::<_, Option<i64>>(2)?.unwrap_or(0),
                    review_cards: r.get::<_, Option<i64>>(3)?.unwrap_or(0),
                    suspended_cards: r.get::<_, Option<i64>>(4)?.unwrap_or(0),
                    due_today: r.get::<_, Option<i64>>(5)?.unwrap_or(0),
                    podcastable_cards: r.get::<_, Option<i64>>(6)?.unwrap_or(0),
                })
            },
        )?;

        Ok(stats)
    }

    /// Bucket the deck's cards into WaniKani-style stages based on FSRS
    /// stability. See [`DeckMastery`] for the exact thresholds.
    pub fn mastery(&self, id: i64) -> AppResult<DeckMastery> {
        // Confirm the deck exists for a nicer error.
        let _ = self.get(id)?;

        // P081 — one conditional-aggregation pass replaces the previous five
        // independent `COUNT(*)` round-trips. The bucket predicates are
        // mutually exclusive and exhaustive over the active (`suspended = 0`)
        // cards, so the five sums add up to the deck's active card count — see
        // [`DeckMastery::total`] and the threshold docs above.
        let mastery = self.conn.query_row(
            "SELECT
                 SUM(CASE WHEN state IN ('new', 'learning', 'relearning')
                            OR (state = 'review' AND (stability IS NULL OR stability < 7.0))
                          THEN 1 ELSE 0 END),
                 SUM(CASE WHEN state = 'review' AND stability >= 7.0 AND stability < 30.0
                          THEN 1 ELSE 0 END),
                 SUM(CASE WHEN state = 'review' AND stability >= 30.0 AND stability < 90.0
                          THEN 1 ELSE 0 END),
                 SUM(CASE WHEN state = 'review' AND stability >= 90.0 AND stability < 180.0
                          THEN 1 ELSE 0 END),
                 SUM(CASE WHEN state = 'review' AND stability >= 180.0
                          THEN 1 ELSE 0 END)
             FROM cards
             WHERE deck_id = ?1 AND suspended = 0",
            params![id],
            |r| {
                Ok(DeckMastery {
                    // `SUM` is NULL when zero rows match; coalesce to 0.
                    apprentice: r.get::<_, Option<i64>>(0)?.unwrap_or(0),
                    guru: r.get::<_, Option<i64>>(1)?.unwrap_or(0),
                    master: r.get::<_, Option<i64>>(2)?.unwrap_or(0),
                    enlightened: r.get::<_, Option<i64>>(3)?.unwrap_or(0),
                    burned: r.get::<_, Option<i64>>(4)?.unwrap_or(0),
                })
            },
        )?;

        Ok(mastery)
    }

    /// Vague 15 — Bloom mastery-gating status for `id`.
    ///
    /// Computes this deck's 30-day retention (rating ≥ 3 counts as correct,
    /// matching the rest of the stats layer), decides whether it is mastered
    /// (≥90 % over ≥20 reviews), then resolves the prerequisite chain one
    /// level deep to answer "is this deck unlocked?". The gate is intentionally
    /// shallow — a prerequisite's own prerequisite does not transitively lock
    /// this deck (the learner unlocks decks one tier at a time).
    pub fn mastery_status(&self, id: i64) -> AppResult<MasteryStatus> {
        let deck = self.get(id)?;
        let now = Utc::now().timestamp();

        let (retention_rate, review_count) = self.deck_retention(id, now)?;
        let mastered =
            retention_rate >= MASTERY_RETENTION_THRESHOLD && review_count >= MASTERY_MIN_REVIEWS;

        let prerequisite_id = deck.prerequisite_deck_id;
        let prerequisite_mastered = match prerequisite_id {
            None => true,
            Some(prereq) => {
                let (prereq_rate, prereq_count) = self.deck_retention(prereq, now)?;
                prereq_rate >= MASTERY_RETENTION_THRESHOLD && prereq_count >= MASTERY_MIN_REVIEWS
            }
        };
        let unlocked = prerequisite_id.is_none() || prerequisite_mastered;

        Ok(MasteryStatus {
            mastered,
            retention_rate,
            review_count,
            prerequisite_id,
            prerequisite_mastered,
            unlocked,
        })
    }

    /// Retention `(rate, count)` for a deck's reviews over the last 30 days.
    /// `rate` is `correct / total` in `[0, 1]` (rating ≥ 3 = correct), `0.0`
    /// when there are no reviews. Joins `reviews → cards` so a card moving
    /// decks (not currently possible) wouldn't double-count.
    fn deck_retention(&self, deck_id: i64, now: i64) -> AppResult<(f64, i64)> {
        let since = now - MASTERY_WINDOW_SECS;
        let (total, correct): (i64, i64) = self.conn.query_row(
            "SELECT COUNT(*),
                    COALESCE(SUM(CASE WHEN r.rating >= 3 THEN 1 ELSE 0 END), 0)
             FROM reviews r
             JOIN cards c ON c.id = r.card_id
             WHERE c.deck_id = ?1 AND r.reviewed_at >= ?2",
            params![deck_id, since],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        let rate = if total > 0 {
            correct as f64 / total as f64
        } else {
            0.0
        };
        Ok((rate, total))
    }
}

fn row_to_deck(row: &Row<'_>) -> rusqlite::Result<Deck> {
    let kind_str: String = row.get(5)?;
    let scheduler_kind = SchedulerKind::from_str(&kind_str).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(
            5,
            rusqlite::types::Type::Text,
            Box::new(std::io::Error::other(e.to_string())),
        )
    })?;
    Ok(Deck {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get(2)?,
        color: row.get(3)?,
        desired_retention: row.get(4)?,
        scheduler_kind,
        language_mode: row.get(6)?,
        prerequisite_deck_id: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::notes::NoteTemplate;
    use crate::db::Database;
    use serde_json::json;

    /// Seed `count` reviews for the first card of `deck_id` at time `now`, all
    /// with `rating` (≥3 = correct for retention). Creates a basic note (hence
    /// a card) first.
    fn seed_reviews(
        db: &Database,
        conn: &rusqlite::Connection,
        deck_id: i64,
        rating: i64,
        count: i64,
        now: i64,
    ) {
        let note = db
            .notes(conn)
            .create(
                deck_id,
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
        for _ in 0..count {
            conn.execute(
                "INSERT INTO reviews (
                    card_id, rating, state_before, state_after,
                    stability_before, stability_after,
                    difficulty_before, difficulty_after,
                    elapsed_days, scheduled_days, review_time, reviewed_at
                 ) VALUES (?1, ?2, 'review', 'review', 1.0, 1.0, 5.0, 5.0, 1, 1, 1000, ?3)",
                params![card_id, rating, now],
            )
            .unwrap();
        }
    }

    #[test]
    fn mastery_status_locked_until_prerequisite_mastered() {
        let db = Database::for_test();
        let conn = db.lock();
        let now = Utc::now().timestamp();

        // Prerequisite deck "A" and gated deck "B" (B requires A).
        let deck_a = db
            .decks(&conn)
            .create("A", None, "#3b82f6", 0.9, None, None, None)
            .unwrap();
        let deck_b = db
            .decks(&conn)
            .create("B", None, "#ef4444", 0.9, None, None, Some(deck_a.id))
            .unwrap();

        // Before any reviews: A not mastered, B locked.
        let status_b = db.decks(&conn).mastery_status(deck_b.id).unwrap();
        assert!(
            !status_b.unlocked,
            "B should be locked before A is mastered"
        );
        assert_eq!(status_b.prerequisite_id, Some(deck_a.id));
        assert!(!status_b.prerequisite_mastered);

        // Too few reviews (only 10, all correct) — still below the 20 floor.
        seed_reviews(&db, &conn, deck_a.id, 4, 10, now);
        let status_b = db.decks(&conn).mastery_status(deck_b.id).unwrap();
        assert!(
            !status_b.unlocked,
            "10 reviews is below the 20-review floor"
        );

        // Now push A well past 20 reviews, all correct → retention 1.0 ≥ 0.9.
        seed_reviews(&db, &conn, deck_a.id, 4, 15, now);
        let status_a = db.decks(&conn).mastery_status(deck_a.id).unwrap();
        assert!(
            status_a.mastered,
            "A should be mastered (25 correct reviews)"
        );
        assert!((status_a.retention_rate - 1.0).abs() < 1e-9);
        assert_eq!(status_a.review_count, 25);

        // B is now unlocked because its prerequisite A is mastered.
        let status_b = db.decks(&conn).mastery_status(deck_b.id).unwrap();
        assert!(status_b.unlocked, "B should unlock once A is mastered");
        assert!(status_b.prerequisite_mastered);
        // B itself has no reviews, so it is not yet mastered.
        assert!(!status_b.mastered);
    }

    #[test]
    fn mastery_status_low_retention_stays_locked() {
        let db = Database::for_test();
        let conn = db.lock();
        let now = Utc::now().timestamp();

        let deck_a = db
            .decks(&conn)
            .create("A", None, "#3b82f6", 0.9, None, None, None)
            .unwrap();
        let deck_b = db
            .decks(&conn)
            .create("B", None, "#ef4444", 0.9, None, None, Some(deck_a.id))
            .unwrap();

        // 25 reviews but all failures (rating 1) → retention 0.0 < 0.9.
        seed_reviews(&db, &conn, deck_a.id, 1, 25, now);
        let status_a = db.decks(&conn).mastery_status(deck_a.id).unwrap();
        assert!(!status_a.mastered, "all-failure deck must not be mastered");
        assert_eq!(status_a.review_count, 25);

        let status_b = db.decks(&conn).mastery_status(deck_b.id).unwrap();
        assert!(
            !status_b.unlocked,
            "B stays locked when A's retention is low"
        );
    }

    /// P013 regression — deleting a deck that is used as another deck's
    /// mastery prerequisite must succeed (the FK is `ON DELETE SET NULL`, so
    /// the gate dissolves) instead of failing with a constraint violation.
    #[test]
    fn deleting_prerequisite_deck_clears_dependent_gate() {
        let db = Database::for_test();
        let conn = db.lock();

        let deck_a = db
            .decks(&conn)
            .create("A", None, "#3b82f6", 0.9, None, None, None)
            .unwrap();
        let deck_b = db
            .decks(&conn)
            .create("B", None, "#ef4444", 0.9, None, None, Some(deck_a.id))
            .unwrap();
        assert_eq!(deck_b.prerequisite_deck_id, Some(deck_a.id));

        // Deleting the prerequisite A must NOT error.
        db.decks(&conn)
            .delete(deck_a.id)
            .expect("deleting a prerequisite deck must succeed");

        // B survives, but its gate has been dissolved (set to NULL).
        let refreshed_b = db.decks(&conn).get(deck_b.id).unwrap();
        assert_eq!(
            refreshed_b.prerequisite_deck_id, None,
            "dependent deck's prerequisite must be reset to NULL on delete"
        );
    }

    /// P014 regression — deleting a deck cascades to its cards (and notes /
    /// reviews) via the explicit `ON DELETE CASCADE` on `cards.deck_id`.
    #[test]
    fn deleting_deck_cascades_to_cards() {
        let db = Database::for_test();
        let conn = db.lock();

        let deck = db
            .decks(&conn)
            .create("C", None, "#3b82f6", 0.9, None, None, None)
            .unwrap();
        // Creating a note also creates its card(s).
        db.notes(&conn)
            .create(
                deck.id,
                NoteTemplate::Basic,
                json!({ "front": "f", "back": "b" }),
                vec![],
                None,
            )
            .unwrap();

        let cards_before: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM cards WHERE deck_id = ?1",
                params![deck.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(cards_before, 1, "note creation should leave one card");

        db.decks(&conn).delete(deck.id).unwrap();

        let cards_after: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM cards WHERE deck_id = ?1",
                params![deck.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(cards_after, 0, "deck delete must cascade to its cards");

        let notes_after: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM notes WHERE deck_id = ?1",
                params![deck.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(notes_after, 0, "deck delete must cascade to its notes");
    }

    /// Helper: create a basic note in `deck_id`, returning its card id.
    fn mk_card(db: &Database, conn: &rusqlite::Connection, deck_id: i64) -> i64 {
        let note = db
            .notes(conn)
            .create(
                deck_id,
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

    /// P080 regression — `total_cards` counts suspended cards too, so the
    /// dashboard's decomposition must hold:
    /// `total = new + learning + review + suspended`. Before the fix there was
    /// no `suspended_cards` summand, so a deck with suspended cards showed a
    /// total that didn't add up.
    #[test]
    fn stats_total_decomposes_with_suspended() {
        let db = Database::for_test();
        let conn = db.lock();
        let deck = db
            .decks(&conn)
            .create("D", None, "#3b82f6", 0.9, None, None, None)
            .unwrap();

        // 2 new (untouched), 1 learning, 1 review, 1 suspended.
        mk_card(&db, &conn, deck.id);
        mk_card(&db, &conn, deck.id);
        let learning = mk_card(&db, &conn, deck.id);
        let review = mk_card(&db, &conn, deck.id);
        let suspended = mk_card(&db, &conn, deck.id);

        conn.execute(
            "UPDATE cards SET state = 'learning' WHERE id = ?1",
            params![learning],
        )
        .unwrap();
        conn.execute(
            "UPDATE cards SET state = 'review', stability = 10.0 WHERE id = ?1",
            params![review],
        )
        .unwrap();
        db.cards(&conn).suspend(suspended, true).unwrap();

        let stats = db.decks(&conn).stats(deck.id).unwrap();
        assert_eq!(stats.total_cards, 5);
        assert_eq!(stats.new_cards, 2);
        assert_eq!(stats.learning_cards, 1);
        assert_eq!(stats.review_cards, 1);
        assert_eq!(stats.suspended_cards, 1);
        // The whole point of P080: the total is fully decomposable.
        assert_eq!(
            stats.total_cards,
            stats.new_cards + stats.learning_cards + stats.review_cards + stats.suspended_cards,
            "total must decompose into new + learning + review + suspended"
        );
    }

    /// P081 regression — the batch `list_with_stats` must agree, deck by deck,
    /// with the per-deck `stats` / `mastery` endpoints it replaces.
    #[test]
    fn list_with_stats_matches_per_deck_endpoints() {
        let db = Database::for_test();
        let conn = db.lock();
        let deck_a = db
            .decks(&conn)
            .create("Alpha", None, "#3b82f6", 0.9, None, None, None)
            .unwrap();
        // Empty deck — must still appear (LEFT JOIN) with all-zero aggregates.
        let deck_b = db
            .decks(&conn)
            .create("Beta", None, "#ef4444", 0.9, None, None, None)
            .unwrap();

        // Populate Alpha: 1 new, 1 review (guru: stability in [7,30)), 1 suspended.
        mk_card(&db, &conn, deck_a.id);
        let guru = mk_card(&db, &conn, deck_a.id);
        let suspended = mk_card(&db, &conn, deck_a.id);
        conn.execute(
            "UPDATE cards SET state = 'review', stability = 15.0 WHERE id = ?1",
            params![guru],
        )
        .unwrap();
        db.cards(&conn).suspend(suspended, true).unwrap();

        let batch = db.decks(&conn).list_with_stats().unwrap();
        assert_eq!(
            batch.len(),
            2,
            "every deck must be present, even empty ones"
        );

        for entry in &batch {
            let stats = db.decks(&conn).stats(entry.deck.id).unwrap();
            let mastery = db.decks(&conn).mastery(entry.deck.id).unwrap();
            assert_eq!(
                entry.stats.total_cards, stats.total_cards,
                "batch total must match per-deck stats"
            );
            assert_eq!(entry.stats.new_cards, stats.new_cards);
            assert_eq!(entry.stats.review_cards, stats.review_cards);
            assert_eq!(entry.stats.suspended_cards, stats.suspended_cards);
            assert_eq!(entry.stats.due_today, stats.due_today);
            assert_eq!(entry.mastery, mastery, "batch mastery must match per-deck");
        }

        // Spot-check the empty deck's zeros.
        let beta = batch.iter().find(|e| e.deck.id == deck_b.id).unwrap();
        assert_eq!(beta.stats.total_cards, 0);
        assert_eq!(beta.mastery.total(), 0);
    }

    #[test]
    fn deck_cannot_be_its_own_prerequisite() {
        let db = Database::for_test();
        let conn = db.lock();
        let deck = db
            .decks(&conn)
            .create("A", None, "#3b82f6", 0.9, None, None, None)
            .unwrap();
        let err = db
            .decks(&conn)
            .update(
                deck.id,
                DeckPatch {
                    prerequisite_deck_id: Some(Some(deck.id)),
                    ..Default::default()
                },
            )
            .unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
    }
}
