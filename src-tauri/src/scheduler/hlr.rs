//! Half-Life Regression (HLR) scheduler.
//!
//! Adapted from Settles & Meeder, *A Trainable Spaced Repetition Model for
//! Language Learning* (ACL 2016) — the algorithm Duolingo deployed in
//! production. The core idea: a memory's **half-life** `h` (the delay at
//! which recall probability drops to 50 %) is a log-linear function of
//! features extracted from the review history.
//!
//! `h = 2^(θ · x)` with features `x = [nb_correct, nb_incorrect, bias]`.
//! Recall probability after `Δ` days is the classic exponential-forgetting
//! curve `p = 2^(-Δ / h)`. To keep `p` at the deck's `desired_retention`
//! (0.9 here, matching the rest of Mnemosys), we solve `p = 2^(-Δ/h)` for
//! `Δ`, giving `interval = h · log2(1 / 0.9) ≈ h · 0.152`.
//!
//! Storage convention (same trick as SM-2 / Leitner — we don't widen the
//! schema):
//! - `stability` carries the running **correct count** (`nb_correct`).
//! - `difficulty` carries the running **incorrect count** (`nb_incorrect`).
//!
//! Both are written back as plain floats. When a learner switches a deck
//! from FSRS-6 to HLR the previous `stability` / `difficulty` are
//! re-interpreted as those two counters; we clamp them to `>= 0` so the
//! half-life stays finite and positive. A single slightly-off interval on
//! the first post-switch review is the same documented trade-off the other
//! pluggable schedulers carry.
//!
//! References
//! ----------
//! - Settles & Meeder 2016, <https://aclanthology.org/P16-1174/>

use crate::db::{Card, CardState};
use crate::error::AppResult;

use super::{Scheduler, SchedulerOutcome};

/// Default feature weights `θ = [θ_correct, θ_incorrect, θ_bias]`. With a
/// fresh card (`0` correct, `0` incorrect) the half-life is `2^θ_bias = 2`
/// days; each prior correct doubles it, each prior lapse halves it.
const THETA_CORRECT: f64 = 1.0;
const THETA_INCORRECT: f64 = -1.0;
const THETA_BIAS: f64 = 1.0;

/// Desired recall probability when the next review comes due. Matches the
/// app-wide FSRS target so the three algorithms feel comparable.
const DESIRED_RETENTION: f64 = 0.9;

/// Clamp the half-life into a sane band (days) so a long unbroken streak or
/// a pile of lapses can't produce a 0-day or multi-century interval.
const MIN_HALF_LIFE_DAYS: f64 = 0.5;
const MAX_HALF_LIFE_DAYS: f64 = 3650.0;

/// HLR scheduler — stateless; the running counts live on the card row.
#[derive(Debug, Default, Clone, Copy)]
pub struct HlrScheduler;

impl Scheduler for HlrScheduler {
    fn name(&self) -> &'static str {
        "hlr"
    }

    fn next_review(
        &self,
        card: &Card,
        rating: u8,
        reviewed_at: i64,
    ) -> AppResult<SchedulerOutcome> {
        let rating = validate_rating(rating)?;
        let elapsed = super::elapsed_days_since(card.last_review, reviewed_at);

        // Read the running counters out of the reused columns, clamped to a
        // valid count (>= 0, finite). A card arriving from another algorithm
        // simply seeds these from whatever it stored.
        let nb_correct_prev = read_count(card.stability);
        let nb_incorrect_prev = read_count(card.difficulty);

        let (next_state, nb_correct, nb_incorrect) =
            apply_rating(card.state, nb_correct_prev, nb_incorrect_prev, rating);

        let half_life = half_life_days(nb_correct, nb_incorrect);
        let interval = interval_from_half_life(half_life);

        Ok(SchedulerOutcome {
            state: next_state,
            stability: nb_correct,
            difficulty: nb_incorrect,
            scheduled_days: interval,
            elapsed_days: elapsed,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum HlrRating {
    Again,
    Hard,
    Good,
    Easy,
}

fn validate_rating(rating: u8) -> AppResult<HlrRating> {
    match rating {
        1 => Ok(HlrRating::Again),
        2 => Ok(HlrRating::Hard),
        3 => Ok(HlrRating::Good),
        4 => Ok(HlrRating::Easy),
        other => Err(crate::error::AppError::Validation(format!(
            "rating must be in [1,4] (got {other})"
        ))),
    }
}

/// Round a stored float into a non-negative feature count. NaN / negative /
/// infinite values collapse to 0 so the half-life stays well-defined.
fn read_count(value: Option<f64>) -> f64 {
    value
        .filter(|v| v.is_finite() && *v >= 0.0)
        .map(|v| v.round())
        .unwrap_or(0.0)
}

/// `h = 2^(θ · x)`, clamped into `[MIN_HALF_LIFE_DAYS, MAX_HALF_LIFE_DAYS]`.
fn half_life_days(nb_correct: f64, nb_incorrect: f64) -> f64 {
    let exponent = THETA_CORRECT * nb_correct + THETA_INCORRECT * nb_incorrect + THETA_BIAS;
    let h = 2f64.powf(exponent);
    h.clamp(MIN_HALF_LIFE_DAYS, MAX_HALF_LIFE_DAYS)
}

/// Solve `desired_retention = 2^(-interval / h)` for the integer interval,
/// i.e. `interval = h · log2(1 / desired_retention)`. Clamped to `>= 1` day.
fn interval_from_half_life(half_life: f64) -> i64 {
    let factor = (1.0 / DESIRED_RETENTION).log2(); // ≈ 0.152
    let interval = (half_life * factor).round() as i64;
    interval.max(1)
}

/// Pure transition: bump the right counter and pick the next lifecycle
/// bucket. `Again` counts as an incorrect answer (and drops the card into
/// relearning); Hard/Good/Easy all count as correct recalls — HLR's signal
/// is binary recalled/forgot, so the three "correct" buttons share a path.
fn apply_rating(
    state_before: CardState,
    nb_correct_prev: f64,
    nb_incorrect_prev: f64,
    rating: HlrRating,
) -> (CardState, f64, f64) {
    match rating {
        HlrRating::Again => {
            let next_state = match state_before {
                CardState::New => CardState::Learning,
                _ => CardState::Relearning,
            };
            (next_state, nb_correct_prev, nb_incorrect_prev + 1.0)
        }
        HlrRating::Hard | HlrRating::Good | HlrRating::Easy => {
            let next_state = match state_before {
                CardState::New | CardState::Learning | CardState::Relearning => CardState::Review,
                CardState::Review => CardState::Review,
            };
            (next_state, nb_correct_prev + 1.0, nb_incorrect_prev)
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
    fn first_good_graduates_and_counts_one_correct() {
        let s = HlrScheduler;
        let out = s.next_review(&fresh_card(), 3, 1_700_000_000).unwrap();
        assert_eq!(out.state, CardState::Review);
        assert!((out.stability - 1.0).abs() < 1e-9, "one correct recall");
        assert!((out.difficulty - 0.0).abs() < 1e-9, "no lapses yet");
        assert!(out.scheduled_days >= 1);
    }

    /// Core property: more correct recalls ⇒ longer interval (half-life
    /// doubles per correct answer).
    #[test]
    fn hlr_correct_grows_interval() {
        let s = HlrScheduler;

        // Card with 1 correct, 0 incorrect.
        let mut low = fresh_card();
        low.state = CardState::Review;
        low.reps = 1;
        low.stability = Some(1.0);
        low.difficulty = Some(0.0);
        let out_low = s.next_review(&low, 3, 1_700_000_000).unwrap();

        // Card with 5 correct, 0 incorrect — much longer half-life.
        let mut high = fresh_card();
        high.state = CardState::Review;
        high.reps = 5;
        high.stability = Some(5.0);
        high.difficulty = Some(0.0);
        let out_high = s.next_review(&high, 3, 1_700_000_000).unwrap();

        assert!(
            out_high.scheduled_days > out_low.scheduled_days,
            "more correct recalls must yield a longer interval ({} vs {})",
            out_high.scheduled_days,
            out_low.scheduled_days
        );
    }

    /// Core property: a lapse shrinks the next interval relative to the same
    /// card answered correctly (incorrect count halves the half-life).
    #[test]
    fn hlr_incorrect_shrinks_interval() {
        let s = HlrScheduler;

        let mut card = fresh_card();
        card.state = CardState::Review;
        card.reps = 6;
        card.stability = Some(4.0); // 4 correct so far
        card.difficulty = Some(0.0); // no lapses yet

        let correct = s.next_review(&card, 3, 1_700_000_000).unwrap();
        let lapsed = s.next_review(&card, 1, 1_700_000_000).unwrap();

        assert!(
            lapsed.scheduled_days < correct.scheduled_days,
            "an Again must schedule sooner than a Good ({} vs {})",
            lapsed.scheduled_days,
            correct.scheduled_days
        );
        assert_eq!(lapsed.state, CardState::Relearning);
        assert!((lapsed.difficulty - 1.0).abs() < 1e-9, "one lapse recorded");
    }

    #[test]
    fn interval_never_below_one_day() {
        // Even a card that has only ever been failed must wait >= 1 day.
        let s = HlrScheduler;
        let mut card = fresh_card();
        card.state = CardState::Review;
        card.reps = 5;
        card.stability = Some(0.0);
        card.difficulty = Some(5.0); // 5 lapses → tiny half-life
        let out = s.next_review(&card, 1, 1_700_000_000).unwrap();
        assert!(out.scheduled_days >= 1);
    }

    #[test]
    fn invalid_rating_errors() {
        let s = HlrScheduler;
        let err = s.next_review(&fresh_card(), 0, 1_700_000_000).unwrap_err();
        assert!(matches!(err, crate::error::AppError::Validation(_)));
    }
}
