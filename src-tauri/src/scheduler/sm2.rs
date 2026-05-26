//! SuperMemo-2 scheduler — the classic Anki algorithm.
//!
//! Adapted from the canonical description on supermemo.guru
//! (`Algorithm_SM-2`) plus Anki's documented adjustments for the
//! four-button (Again/Hard/Good/Easy) interface. The original SM-2 only
//! has two outcomes (correct/forgot); the Anki-style adaptation maps
//! Hard/Good/Easy onto three different multipliers around the easiness
//! factor and reserves Again for resets.
//!
//! Storage convention
//! ------------------
//! Mnemosys persists scheduling metadata in the existing `cards.stability`
//! and `cards.difficulty` columns. To avoid widening the schema again we
//! reuse them:
//!
//! - `stability` is always written back as `0.0` (SM-2 has no analogue).
//! - `difficulty` carries the **easiness factor** (EF). Defaults to
//!   `EF_DEFAULT = 2.5` and is clamped to `EF_MIN = 1.3`.
//!
//! When the user switches a deck from FSRS-6 to SM-2, the previous FSRS
//! `difficulty` (which sits in `[1, 10]`) will be re-interpreted as the
//! initial EF. Some scaling drift is unavoidable until the card sees
//! its next review — this is a documented limitation.
//!
//! References
//! ----------
//! - <https://supermemo.guru/wiki/Algorithm_SM-2>
//! - <https://docs.ankiweb.net/deck-options.html#new-cards> (button
//!   intervals for fresh cards)

use crate::db::{Card, CardState};
use crate::error::AppResult;

use super::{Scheduler, SchedulerOutcome};

/// Default easiness factor for a brand-new card.
pub const EF_DEFAULT: f64 = 2.5;

/// Lowest allowed easiness factor. Anki uses the same floor.
pub const EF_MIN: f64 = 1.3;

/// Multiplicative bonus on top of `EF` when the rating is Easy.
const EASY_BONUS: f64 = 1.3;

/// SM-2 scheduler — stateless (the algorithm is fully driven by the
/// card row passed in).
#[derive(Debug, Default, Clone, Copy)]
pub struct Sm2Scheduler;

impl Scheduler for Sm2Scheduler {
    fn name(&self) -> &'static str {
        "sm2"
    }

    fn next_review(
        &self,
        card: &Card,
        rating: u8,
        reviewed_at: i64,
    ) -> AppResult<SchedulerOutcome> {
        let rating = validate_rating(rating)?;
        let elapsed = super::elapsed_days_since(card.last_review, reviewed_at);

        // Existing EF — clamp because a card coming from FSRS-6 may have
        // a `difficulty` in [1, 10] which is outside SM-2's natural range.
        let ef_prev = card
            .difficulty
            .filter(|d| d.is_finite())
            .map(|d| d.clamp(EF_MIN, 4.0))
            .unwrap_or(EF_DEFAULT);

        let prev_interval = card.scheduled_days.max(0);
        let is_new = matches!(card.state, CardState::New) || card.reps == 0;

        let (next_state, next_interval, ef_next) =
            apply_rating(card.state, prev_interval, ef_prev, is_new, rating);

        Ok(SchedulerOutcome {
            state: next_state,
            stability: 0.0,
            difficulty: ef_next,
            scheduled_days: next_interval,
            elapsed_days: elapsed,
        })
    }
}

/// Rating in `1..=4` parsed as a strict enum so the match below is
/// exhaustive.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Sm2Rating {
    Again,
    Hard,
    Good,
    Easy,
}

fn validate_rating(rating: u8) -> AppResult<Sm2Rating> {
    match rating {
        1 => Ok(Sm2Rating::Again),
        2 => Ok(Sm2Rating::Hard),
        3 => Ok(Sm2Rating::Good),
        4 => Ok(Sm2Rating::Easy),
        other => Err(crate::error::AppError::Validation(format!(
            "rating must be in [1,4] (got {other})"
        ))),
    }
}

/// Pure SM-2 transition function. Returns `(next_state, next_interval_days,
/// next_ef)`. Extracted out so the unit tests can exercise the math
/// without touching the DB.
fn apply_rating(
    state_before: CardState,
    prev_interval: i64,
    ef_prev: f64,
    is_new: bool,
    rating: Sm2Rating,
) -> (CardState, i64, f64) {
    // First review of a brand-new card: use fixed initial intervals,
    // mirroring the Anki defaults so the experience matches what learners
    // coming from Anki expect.
    if is_new {
        return match rating {
            Sm2Rating::Again => (CardState::Learning, 1, EF_DEFAULT),
            Sm2Rating::Hard => (CardState::Learning, 4, EF_DEFAULT),
            Sm2Rating::Good => (CardState::Review, 6, EF_DEFAULT),
            Sm2Rating::Easy => (CardState::Review, 10, EF_DEFAULT),
        };
    }

    // Subsequent reviews. EF starts from whatever the card had on disk.
    let interval_floor: i64 = 1;
    match rating {
        Sm2Rating::Again => {
            // A miss drops the card into relearning with a 0-day interval
            // (Anki "relearning" semantics — re-test within the same
            // session) and bumps the easiness factor down by 0.2.
            let ef_next = (ef_prev - 0.2).max(EF_MIN);
            (CardState::Relearning, 0, ef_next)
        }
        Sm2Rating::Hard => {
            let ef_next = (ef_prev - 0.15).max(EF_MIN);
            let interval = ((prev_interval as f64) * 1.2)
                .round()
                .max(interval_floor as f64) as i64;
            let next_state = if matches!(state_before, CardState::Learning | CardState::Relearning)
            {
                CardState::Review
            } else {
                state_before
            };
            (next_state, interval, ef_next)
        }
        Sm2Rating::Good => {
            let ef_next = ef_prev; // unchanged
            let interval = ((prev_interval as f64) * ef_next)
                .round()
                .max(interval_floor as f64) as i64;
            (CardState::Review, interval, ef_next)
        }
        Sm2Rating::Easy => {
            let ef_next = ef_prev + 0.15; // no upper bound in SM-2
            let interval = ((prev_interval as f64) * ef_next * EASY_BONUS)
                .round()
                .max(interval_floor as f64) as i64;
            (CardState::Review, interval, ef_next)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::CardState;

    fn fresh_card() -> Card {
        Card {
            id: 1,
            note_id: 1,
            deck_id: 1,
            card_ord: 0,
            state: CardState::New,
            stability: None,
            difficulty: None,
            last_review: None,
            next_review: None,
            elapsed_days: 0,
            scheduled_days: 0,
            reps: 0,
            lapses: 0,
            suspended: false,
            created_at: 0,
            updated_at: 0,
        }
    }

    #[test]
    fn first_review_good_yields_6_day_interval() {
        let s = Sm2Scheduler;
        let out = s.next_review(&fresh_card(), 3, 1_700_000_000).unwrap();
        assert_eq!(out.scheduled_days, 6);
        assert_eq!(out.state, CardState::Review);
        assert!((out.difficulty - EF_DEFAULT).abs() < 1e-9);
        assert_eq!(out.stability, 0.0);
    }

    #[test]
    fn first_review_again_keeps_card_in_learning() {
        let s = Sm2Scheduler;
        let out = s.next_review(&fresh_card(), 1, 1_700_000_000).unwrap();
        assert_eq!(out.state, CardState::Learning);
        assert_eq!(out.scheduled_days, 1);
    }

    #[test]
    fn good_on_review_multiplies_by_ef() {
        let s = Sm2Scheduler;
        let mut card = fresh_card();
        card.state = CardState::Review;
        card.reps = 5;
        card.scheduled_days = 10;
        card.difficulty = Some(2.5);

        let out = s.next_review(&card, 3, 1_700_000_000).unwrap();
        assert_eq!(out.scheduled_days, 25); // 10 * 2.5
        assert!((out.difficulty - 2.5).abs() < 1e-9);
    }

    #[test]
    fn again_clamps_ef_at_floor() {
        let s = Sm2Scheduler;
        let mut card = fresh_card();
        card.state = CardState::Review;
        card.reps = 10;
        card.scheduled_days = 20;
        card.difficulty = Some(1.3); // already at floor

        let out = s.next_review(&card, 1, 1_700_000_000).unwrap();
        assert_eq!(out.state, CardState::Relearning);
        assert_eq!(out.scheduled_days, 0);
        assert!((out.difficulty - EF_MIN).abs() < 1e-9);
    }

    #[test]
    fn easy_bonus_extends_interval() {
        let s = Sm2Scheduler;
        let mut card = fresh_card();
        card.state = CardState::Review;
        card.reps = 5;
        card.scheduled_days = 10;
        card.difficulty = Some(2.5);

        let out = s.next_review(&card, 4, 1_700_000_000).unwrap();
        // (2.5 + 0.15) * 1.3 * 10 = 34.45 → 34 (round-to-nearest)
        assert_eq!(out.scheduled_days, 34);
        assert!(out.difficulty > 2.5);
    }

    #[test]
    fn invalid_rating_errors() {
        let s = Sm2Scheduler;
        let err = s.next_review(&fresh_card(), 0, 1_700_000_000).unwrap_err();
        assert!(matches!(err, crate::error::AppError::Validation(_)));
    }
}
