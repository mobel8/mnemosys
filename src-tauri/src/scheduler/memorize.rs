//! MEMORIZE scheduler — spaced repetition as stochastic optimal control.
//!
//! Adapted from Tabibian, Upadhyay, De, Zarezade, Schölkopf & Gomez-Rodriguez,
//! *Enhancing Human Learning via Spaced Repetition Optimization* (PNAS 2019).
//! The paper models recall with an exponential forgetting curve whose rate
//! `n` (the "forgetting rate") rises when you forget and falls when you
//! recall, and proves that the *reviewing intensity* minimising the expected
//! recall risk under a quadratic effort cost is
//!
//! ```text
//! u*(t) = (1 / √q) · (1 − m(t))
//! ```
//!
//! where `m(t)` is the recall probability and `q` trades off effort against
//! retention. The practical consequence for a discrete card scheduler: the
//! optimal *spacing* between reviews scales like `1 / √n` — review more often
//! when the forgetting rate is high, space out when it is low.
//!
//! Pragmatic implementation
//! -------------------------
//! We maintain the forgetting rate `n` directly (Tabibian's exponential
//! curve `m = e^{-n·Δ}`) and set
//!
//! ```text
//! interval = C / √n        (clamped to >= 1 day)
//! ```
//!
//! with `C` calibrated so a freshly-learned card (`n = N_DEFAULT`) lands a
//! few days out. A `1` (Again) multiplies `n` up (you forget faster); a `4`
//! (Easy) divides it down (you forget slower, so review later); Hard / Good
//! nudge it by smaller factors. This reproduces the qualitative behaviour of
//! the optimal policy — interval grows with retention, shrinks after a
//! lapse — without solving the full stochastic differential equation online.
//!
//! Storage convention (same trick as the other pluggable schedulers):
//! - `stability` is always `0.0` (no analogue here).
//! - `difficulty` carries the forgetting rate `n` (a small positive float).
//!
//! Switching a deck onto MEMORIZE re-interprets the existing `difficulty` as
//! `n`; we clamp it into a sane band so the first interval can't explode.
//!
//! References
//! ----------
//! - Tabibian et al. 2019, <https://www.pnas.org/doi/10.1073/pnas.1815156116>

use crate::db::{Card, CardState};
use crate::error::AppResult;

use super::{Scheduler, SchedulerOutcome};

/// Forgetting rate seeded onto a brand-new card. With the calibration below
/// this puts the very first interval at roughly `C / √0.3 ≈ 5` days.
pub const N_DEFAULT: f64 = 0.3;

/// Calibration constant `C` in `interval = C / √n`. Picked so typical rates
/// (0.05–1.0) map onto human-friendly day intervals (≈ 3–12 days).
const INTERVAL_SCALE: f64 = 2.7;

/// Multiplicative updates applied to the forgetting rate per rating. Again
/// makes the card more forgettable; Easy makes it stick.
const AGAIN_FACTOR: f64 = 2.0;
const HARD_FACTOR: f64 = 1.2;
const GOOD_FACTOR: f64 = 0.6;
const EASY_FACTOR: f64 = 0.35;

/// Keep `n` strictly positive and bounded so `1/√n` never blows up or
/// collapses to zero.
const MIN_RATE: f64 = 0.01;
const MAX_RATE: f64 = 5.0;

/// MEMORIZE scheduler — stateless; the forgetting rate lives on the card.
#[derive(Debug, Default, Clone, Copy)]
pub struct MemorizeScheduler;

impl Scheduler for MemorizeScheduler {
    fn name(&self) -> &'static str {
        "memorize"
    }

    fn next_review(
        &self,
        card: &Card,
        rating: u8,
        reviewed_at: i64,
    ) -> AppResult<SchedulerOutcome> {
        let rating = validate_rating(rating)?;
        let elapsed = super::elapsed_days_since(card.last_review, reviewed_at);

        let n_prev = read_rate(card.difficulty);
        let (next_state, n_next) = apply_rating(card.state, n_prev, rating);
        let interval = interval_from_rate(n_next);

        Ok(SchedulerOutcome {
            state: next_state,
            stability: 0.0,
            difficulty: n_next,
            scheduled_days: interval,
            elapsed_days: elapsed,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MemorizeRating {
    Again,
    Hard,
    Good,
    Easy,
}

fn validate_rating(rating: u8) -> AppResult<MemorizeRating> {
    match rating {
        1 => Ok(MemorizeRating::Again),
        2 => Ok(MemorizeRating::Hard),
        3 => Ok(MemorizeRating::Good),
        4 => Ok(MemorizeRating::Easy),
        other => Err(crate::error::AppError::Validation(format!(
            "rating must be in [1,4] (got {other})"
        ))),
    }
}

/// Read the stored forgetting rate, clamped into `[MIN_RATE, MAX_RATE]`.
/// A missing / non-finite / non-positive value seeds `N_DEFAULT`.
fn read_rate(value: Option<f64>) -> f64 {
    value
        .filter(|v| v.is_finite() && *v > 0.0)
        .map(|v| v.clamp(MIN_RATE, MAX_RATE))
        .unwrap_or(N_DEFAULT)
}

/// `interval = C / √n`, rounded and clamped to `>= 1` day.
fn interval_from_rate(n: f64) -> i64 {
    let interval = (INTERVAL_SCALE / n.sqrt()).round() as i64;
    interval.max(1)
}

/// Pure transition: scale the forgetting rate by the rating's factor and
/// pick the next lifecycle bucket. Mirrors the other schedulers' state rules
/// (Again → Relearning; first correct graduates out of New/Learning).
fn apply_rating(
    state_before: CardState,
    n_prev: f64,
    rating: MemorizeRating,
) -> (CardState, f64) {
    let factor = match rating {
        MemorizeRating::Again => AGAIN_FACTOR,
        MemorizeRating::Hard => HARD_FACTOR,
        MemorizeRating::Good => GOOD_FACTOR,
        MemorizeRating::Easy => EASY_FACTOR,
    };
    let n_next = (n_prev * factor).clamp(MIN_RATE, MAX_RATE);

    let next_state = match rating {
        MemorizeRating::Again => match state_before {
            CardState::New => CardState::Learning,
            _ => CardState::Relearning,
        },
        _ => match state_before {
            CardState::New | CardState::Learning | CardState::Relearning => CardState::Review,
            CardState::Review => CardState::Review,
        },
    };

    (next_state, n_next)
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
    fn first_good_graduates_to_review() {
        let s = MemorizeScheduler;
        let out = s.next_review(&fresh_card(), 3, 1_700_000_000).unwrap();
        assert_eq!(out.state, CardState::Review);
        assert_eq!(out.stability, 0.0);
        assert!(out.scheduled_days >= 1);
        // Good lowers the default rate, so the first interval is comfortably
        // more than one day.
        assert!(out.scheduled_days > 1);
    }

    /// Core property: an Again increases the forgetting rate (stored in
    /// `difficulty`) relative to where it started.
    #[test]
    fn memorize_again_increases_forgetting_rate() {
        let s = MemorizeScheduler;
        let mut card = fresh_card();
        card.state = CardState::Review;
        card.reps = 3;
        card.difficulty = Some(0.3);

        let out = s.next_review(&card, 1, 1_700_000_000).unwrap();
        assert!(
            out.difficulty > 0.3,
            "Again must raise the forgetting rate (got {})",
            out.difficulty
        );
        assert_eq!(out.state, CardState::Relearning);
    }

    /// Core property: Easy lowers the forgetting rate, which extends the
    /// interval compared to answering the same card Good.
    #[test]
    fn memorize_easy_extends_interval() {
        let s = MemorizeScheduler;
        let mut card = fresh_card();
        card.state = CardState::Review;
        card.reps = 4;
        card.difficulty = Some(0.5);

        let good = s.next_review(&card, 3, 1_700_000_000).unwrap();
        let easy = s.next_review(&card, 4, 1_700_000_000).unwrap();

        assert!(
            easy.scheduled_days > good.scheduled_days,
            "Easy must schedule further out than Good ({} vs {})",
            easy.scheduled_days,
            good.scheduled_days
        );
        assert!(easy.difficulty < good.difficulty, "Easy lowers the rate more");
    }

    #[test]
    fn rate_is_clamped_and_interval_stays_positive() {
        let s = MemorizeScheduler;
        let mut card = fresh_card();
        card.state = CardState::Review;
        card.reps = 9;
        card.difficulty = Some(4.0); // already high

        // Repeated Again can't push the rate past MAX_RATE.
        let out = s.next_review(&card, 1, 1_700_000_000).unwrap();
        assert!(out.difficulty <= MAX_RATE + 1e-9);
        assert!(out.scheduled_days >= 1);
    }

    #[test]
    fn invalid_rating_errors() {
        let s = MemorizeScheduler;
        let err = s.next_review(&fresh_card(), 5, 1_700_000_000).unwrap_err();
        assert!(matches!(err, crate::error::AppError::Validation(_)));
    }
}
