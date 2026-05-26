//! Leitner 5-box scheduler — the simplest of the three.
//!
//! Each card lives in one of 5 boxes (`0..=4`). The box determines the
//! next interval:
//!
//! | Box | Interval |
//! |-----|----------|
//! | 0   | 1 day    |
//! | 1   | 3 days   |
//! | 2   | 7 days   |
//! | 3   | 14 days  |
//! | 4   | 30 days  |
//!
//! Rating transitions:
//! - **Again** — back to box 0 (and Relearning state).
//! - **Hard**  — box unchanged (stays Review).
//! - **Good**  — `box = min(box + 1, 4)` (graduates from Learning the
//!   first time around).
//! - **Easy**  — `box = min(box + 2, 4)`.
//!
//! Storage convention (same trick as SM-2):
//! - `stability` is always `0.0` — Leitner has no analogue.
//! - `difficulty` carries the **box index** `0..=4` as `f64`.
//!
//! Like SM-2, switching a deck from FSRS-6 to Leitner re-interprets the
//! existing `difficulty`; we clamp it to `[0, 4]` to stay safe.

use crate::db::{Card, CardState};
use crate::error::AppResult;

use super::{Scheduler, SchedulerOutcome};

/// Interval in days for each Leitner box, indexed by box number.
pub const BOX_INTERVALS_DAYS: [i64; 5] = [1, 3, 7, 14, 30];

/// Highest box number.
const MAX_BOX: i64 = 4;

/// Leitner scheduler — stateless.
#[derive(Debug, Default, Clone, Copy)]
pub struct LeitnerScheduler;

impl Scheduler for LeitnerScheduler {
    fn name(&self) -> &'static str {
        "leitner"
    }

    fn next_review(
        &self,
        card: &Card,
        rating: u8,
        reviewed_at: i64,
    ) -> AppResult<SchedulerOutcome> {
        let rating = validate_rating(rating)?;
        let elapsed = super::elapsed_days_since(card.last_review, reviewed_at);

        // Box index — clamp into [0, 4] so cards arriving from FSRS-6
        // (where `difficulty` can be in [1, 10]) don't blow up the
        // interval lookup.
        let box_prev = card
            .difficulty
            .filter(|d| d.is_finite())
            .map(|d| d.round() as i64)
            .map(|n| n.clamp(0, MAX_BOX))
            .unwrap_or(0);

        let is_new = matches!(card.state, CardState::New) || card.reps == 0;

        let (next_state, box_next) = transition(card.state, box_prev, is_new, rating);
        let interval = BOX_INTERVALS_DAYS[box_next as usize];

        Ok(SchedulerOutcome {
            state: next_state,
            stability: 0.0,
            difficulty: box_next as f64,
            scheduled_days: interval,
            elapsed_days: elapsed,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LeitnerRating {
    Again,
    Hard,
    Good,
    Easy,
}

fn validate_rating(rating: u8) -> AppResult<LeitnerRating> {
    match rating {
        1 => Ok(LeitnerRating::Again),
        2 => Ok(LeitnerRating::Hard),
        3 => Ok(LeitnerRating::Good),
        4 => Ok(LeitnerRating::Easy),
        other => Err(crate::error::AppError::Validation(format!(
            "rating must be in [1,4] (got {other})"
        ))),
    }
}

/// Pure Leitner transition. Returns `(next_state, next_box)`.
fn transition(
    state_before: CardState,
    box_prev: i64,
    is_new: bool,
    rating: LeitnerRating,
) -> (CardState, i64) {
    // A first Good/Easy on a new card graduates it out of "new" the same
    // way FSRS does, so the rest of the app (filters by state) keeps
    // working uniformly.
    if is_new {
        return match rating {
            LeitnerRating::Again => (CardState::Learning, 0),
            LeitnerRating::Hard => (CardState::Learning, 0),
            LeitnerRating::Good => (CardState::Review, 1),
            LeitnerRating::Easy => (CardState::Review, 2),
        };
    }

    let box_next = match rating {
        LeitnerRating::Again => 0,
        LeitnerRating::Hard => box_prev.clamp(0, MAX_BOX),
        LeitnerRating::Good => (box_prev + 1).min(MAX_BOX),
        LeitnerRating::Easy => (box_prev + 2).min(MAX_BOX),
    };

    let next_state = match rating {
        LeitnerRating::Again => CardState::Relearning,
        _ => {
            if matches!(state_before, CardState::Learning | CardState::Relearning) {
                CardState::Review
            } else {
                state_before
            }
        }
    };

    (next_state, box_next)
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
    fn first_good_lands_in_box_1() {
        let s = LeitnerScheduler;
        let out = s.next_review(&fresh_card(), 3, 1_700_000_000).unwrap();
        assert_eq!(out.scheduled_days, 3);
        assert_eq!(out.difficulty as i64, 1);
        assert_eq!(out.state, CardState::Review);
    }

    #[test]
    fn first_easy_jumps_to_box_2() {
        let s = LeitnerScheduler;
        let out = s.next_review(&fresh_card(), 4, 1_700_000_000).unwrap();
        assert_eq!(out.scheduled_days, 7);
        assert_eq!(out.difficulty as i64, 2);
    }

    #[test]
    fn again_drops_to_box_zero() {
        let s = LeitnerScheduler;
        let mut card = fresh_card();
        card.state = CardState::Review;
        card.reps = 4;
        card.difficulty = Some(3.0); // box 3

        let out = s.next_review(&card, 1, 1_700_000_000).unwrap();
        assert_eq!(out.difficulty as i64, 0);
        assert_eq!(out.scheduled_days, 1);
        assert_eq!(out.state, CardState::Relearning);
    }

    #[test]
    fn easy_caps_at_box_4() {
        let s = LeitnerScheduler;
        let mut card = fresh_card();
        card.state = CardState::Review;
        card.reps = 8;
        card.difficulty = Some(3.0);

        let out = s.next_review(&card, 4, 1_700_000_000).unwrap();
        assert_eq!(out.difficulty as i64, 4); // 3+2=5 → clamped
        assert_eq!(out.scheduled_days, 30);
    }

    #[test]
    fn hard_keeps_box() {
        let s = LeitnerScheduler;
        let mut card = fresh_card();
        card.state = CardState::Review;
        card.reps = 4;
        card.difficulty = Some(2.0);

        let out = s.next_review(&card, 2, 1_700_000_000).unwrap();
        assert_eq!(out.difficulty as i64, 2);
        assert_eq!(out.scheduled_days, 7);
    }

    #[test]
    fn invalid_rating_errors() {
        let s = LeitnerScheduler;
        let err = s.next_review(&fresh_card(), 9, 1_700_000_000).unwrap_err();
        assert!(matches!(err, crate::error::AppError::Validation(_)));
    }
}
