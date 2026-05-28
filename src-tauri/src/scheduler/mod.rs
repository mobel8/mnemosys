//! Pluggable per-deck schedulers (Vague 4).
//!
//! Mnemosys ships three scheduling algorithms; each deck picks one through
//! its [`crate::db::Deck::scheduler_kind`] column:
//!
//! - **FSRS-6** (default, [`fsrs6_adapter`]) — adaptive, 21-parameter,
//!   predicts retention. Owned by the long-lived
//!   [`crate::fsrs::CardScheduler`] held in [`crate::app_state::AppState`].
//! - **SM-2** ([`sm2`]) — the classic SuperMemo-2 algorithm popularised by
//!   Anki. Deterministic, auditable, no global parameter set.
//! - **Leitner** ([`leitner`]) — 5-box system. Forgiving and very
//!   predictable; convenient for low-stakes decks or beginners.
//!
//! Every algorithm implements [`Scheduler`] which produces a
//! [`SchedulerOutcome`] from the trio `(card, rating, reviewed_at)`. The
//! outcome is then persisted via
//! [`crate::db::cards::CardRepo::update_after_review`] just like the
//! existing FSRS flow — keeping the storage schema unchanged.
//!
//! Cross-algorithm migration: if the learner switches a deck's
//! `scheduler_kind`, existing cards keep their `stability` / `difficulty`
//! values. Each algorithm re-interprets those fields differently (FSRS
//! uses both literally, SM-2 stores the easiness factor in `difficulty`,
//! Leitner stores the box index in `difficulty`), so the first review
//! after a switch may produce a slightly off interval. This is a known,
//! documented trade-off and is *not* fixed by a wipe — the learner can
//! always reset a card from the UI if they want a true fresh start.

pub mod fsrs6_adapter;
pub mod leitner;
pub mod sm2;

use std::str::FromStr;

use serde::{Deserialize, Serialize};

use crate::db::{Card, CardState};
use crate::error::{AppError, AppResult};

/// Which scheduling algorithm a deck uses.
///
/// Stored in the `decks.scheduler_kind` TEXT column. Serde uses
/// lowercase strings (`"fsrs6"`, `"sm2"`, `"leitner"`) so the wire
/// format matches what SQLite stores and what the frontend ships.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SchedulerKind {
    #[default]
    Fsrs6,
    Sm2,
    Leitner,
}

impl SchedulerKind {
    /// Storage representation — matches the values allowed by the CHECK
    /// constraint on `decks.scheduler_kind`.
    pub fn as_str(self) -> &'static str {
        match self {
            SchedulerKind::Fsrs6 => "fsrs6",
            SchedulerKind::Sm2 => "sm2",
            SchedulerKind::Leitner => "leitner",
        }
    }
}

impl FromStr for SchedulerKind {
    type Err = AppError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "fsrs6" => Ok(SchedulerKind::Fsrs6),
            "sm2" => Ok(SchedulerKind::Sm2),
            "leitner" => Ok(SchedulerKind::Leitner),
            other => Err(AppError::Validation(format!(
                "unknown scheduler_kind '{}'",
                other
            ))),
        }
    }
}

/// Outcome of applying a single rating to a card.
///
/// `state` is the new lifecycle bucket the card belongs to (matches the
/// existing [`CardState`] enum so the persisted schema stays untouched).
/// `stability` and `difficulty` are stored verbatim in `cards.stability`
/// and `cards.difficulty`; each algorithm gives them its own meaning:
///
/// - **FSRS-6** — both are the FSRS memory-state floats.
/// - **SM-2** — `stability = 0.0`, `difficulty` holds the *easiness
///   factor* (EF, default 2.5, min 1.3).
/// - **Leitner** — `stability = 0.0`, `difficulty` holds the *box index*
///   `0..=4` cast to `f64`.
///
/// `scheduled_days` is the integer interval (clamped >= 0) used to
/// compute `cards.next_review`. `elapsed_days` is the number of days
/// since the previous review (0 for new cards) and is mainly there for
/// the review-log row downstream.
#[derive(Debug, Clone, Copy)]
pub struct SchedulerOutcome {
    pub state: CardState,
    pub stability: f64,
    pub difficulty: f64,
    pub scheduled_days: i64,
    pub elapsed_days: i64,
}

/// Common interface every per-deck algorithm implements. Implementations
/// must be **pure** with respect to `(card, rating, reviewed_at)` — all
/// the inputs they need to compute the next state live on the [`Card`].
pub trait Scheduler {
    /// Compute the next state for `card` given a `rating` in `1..=4`
    /// (`1=Again`, `2=Hard`, `3=Good`, `4=Easy`) and a unix-seconds
    /// timestamp `reviewed_at`. Implementations validate `rating` and
    /// return `AppError::Validation` if it is out of range.
    fn next_review(&self, card: &Card, rating: u8, reviewed_at: i64)
        -> AppResult<SchedulerOutcome>;

    /// Stable identifier used in logs (`"fsrs6"`, `"sm2"`, `"leitner"`).
    fn name(&self) -> &'static str;

    /// Preview the four possible outcomes (one per rating). The default
    /// implementation runs [`Self::next_review`] four times — algorithms
    /// can override for efficiency but the math has to match.
    fn preview(&self, card: &Card, reviewed_at: i64) -> AppResult<RatingPreview> {
        Ok(RatingPreview {
            again: self.next_review(card, 1, reviewed_at)?,
            hard: self.next_review(card, 2, reviewed_at)?,
            good: self.next_review(card, 3, reviewed_at)?,
            easy: self.next_review(card, 4, reviewed_at)?,
        })
    }
}

/// Four-button preview (matches the UI's "if you press X, next due is …"
/// row). Returned by [`Scheduler::preview`].
#[derive(Debug, Clone, Copy)]
pub struct RatingPreview {
    pub again: SchedulerOutcome,
    pub hard: SchedulerOutcome,
    pub good: SchedulerOutcome,
    pub easy: SchedulerOutcome,
}

/// Build the right [`Scheduler`] for `kind`, borrowing the long-lived
/// FSRS engine when needed. The returned trait object captures the
/// borrow for FSRS-6 (so it can call into the global tensor-backed
/// engine) — for the deterministic SM-2 / Leitner branches the inner
/// value is owned and the lifetime is effectively `'static`.
pub fn from_kind<'a>(
    kind: SchedulerKind,
    fsrs: &'a crate::fsrs::CardScheduler,
) -> Box<dyn Scheduler + 'a> {
    match kind {
        SchedulerKind::Fsrs6 => Box::new(fsrs6_adapter::Fsrs6Adapter::new(fsrs)),
        SchedulerKind::Sm2 => Box::new(sm2::Sm2Scheduler),
        SchedulerKind::Leitner => Box::new(leitner::LeitnerScheduler),
    }
}

/// Days between `last_review` (unix seconds, may be `None`) and `now`
/// (unix seconds). Clamped to 0 for new cards or future timestamps.
/// Shared by every scheduler so the elapsed-days math stays consistent.
pub(crate) fn elapsed_days_since(last_review: Option<i64>, now: i64) -> i64 {
    match last_review {
        Some(ts) => {
            let secs = (now - ts).max(0);
            secs / 86_400
        }
        None => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kind_round_trips_through_string() {
        for k in [
            SchedulerKind::Fsrs6,
            SchedulerKind::Sm2,
            SchedulerKind::Leitner,
        ] {
            assert_eq!(SchedulerKind::from_str(k.as_str()).unwrap(), k);
        }
    }

    #[test]
    fn unknown_kind_is_a_validation_error() {
        let err = SchedulerKind::from_str("anki21").unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
    }

    #[test]
    fn default_kind_is_fsrs6() {
        assert_eq!(SchedulerKind::default(), SchedulerKind::Fsrs6);
    }
}
