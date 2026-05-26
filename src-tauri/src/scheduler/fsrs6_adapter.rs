//! Adapter exposing the long-lived FSRS-6 engine through the
//! [`crate::scheduler::Scheduler`] trait.
//!
//! Why an adapter rather than reusing [`crate::fsrs::CardScheduler`]
//! directly? Two reasons:
//!
//! 1. The trait gives a uniform call site in `commands/review.rs`; we
//!    no longer have to branch the persistence path on the algorithm.
//! 2. The trait's [`crate::scheduler::SchedulerOutcome`] uses the same
//!    storage convention as SM-2 / Leitner (state + stability +
//!    difficulty + interval), which keeps the `cards.update_after_review`
//!    code path uniform.
//!
//! All the actual math stays inside [`crate::fsrs::CardScheduler`] —
//! this file is just a thin glue layer.

use crate::db::{Card, CardState};
use crate::error::AppResult;
use crate::fsrs::{CardScheduler, MemoryStateDTO, Rating};

use super::{Scheduler, SchedulerOutcome};

/// Borrows the process-wide [`CardScheduler`] so multiple invocations
/// share the same parameter vector + retention target.
pub struct Fsrs6Adapter<'a> {
    fsrs: &'a CardScheduler,
}

impl<'a> Fsrs6Adapter<'a> {
    pub fn new(fsrs: &'a CardScheduler) -> Self {
        Self { fsrs }
    }
}

impl<'a> Scheduler for Fsrs6Adapter<'a> {
    fn name(&self) -> &'static str {
        "fsrs6"
    }

    fn next_review(
        &self,
        card: &Card,
        rating: u8,
        reviewed_at: i64,
    ) -> AppResult<SchedulerOutcome> {
        let rating_enum = Rating::from_u8(rating)?;

        let current = match (card.stability, card.difficulty) {
            (Some(s), Some(d)) => Some(MemoryStateDTO {
                stability: s as f32,
                difficulty: d as f32,
            }),
            _ => None,
        };

        let elapsed = super::elapsed_days_since(card.last_review, reviewed_at);
        let elapsed_u32: u32 = elapsed.try_into().unwrap_or(0);

        let outcome = self.fsrs.apply_review(current, elapsed_u32, rating_enum)?;

        let next_state = next_card_state(card.state, rating_enum);

        Ok(SchedulerOutcome {
            state: next_state,
            stability: outcome.memory.stability as f64,
            difficulty: outcome.memory.difficulty as f64,
            scheduled_days: outcome.scheduled_days as i64,
            elapsed_days: elapsed,
        })
    }
}

/// Lifecycle transition for FSRS — same rules as the pre-adapter code
/// in `commands/review.rs`. Kept private so the SM-2 / Leitner branches
/// can have their own variant of the rule (they do, inline).
fn next_card_state(before: CardState, rating: Rating) -> CardState {
    match (before, rating) {
        (CardState::New, Rating::Again) => CardState::Learning,
        (_, Rating::Again) => CardState::Relearning,
        (CardState::New, _) => CardState::Learning,
        (CardState::Learning, _) | (CardState::Relearning, _) => CardState::Review,
        (CardState::Review, _) => CardState::Review,
    }
}
