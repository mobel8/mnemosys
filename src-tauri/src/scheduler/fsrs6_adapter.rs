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
///
/// `retention_override` lets a single review honour the *deck's* per-deck
/// `desired_retention` instead of the engine's global default (P006). `None`
/// falls back to the engine's configured retention.
pub struct Fsrs6Adapter<'a> {
    fsrs: &'a CardScheduler,
    retention_override: Option<f32>,
}

impl<'a> Fsrs6Adapter<'a> {
    /// Adapter using the engine's global retention target.
    pub fn new(fsrs: &'a CardScheduler) -> Self {
        Self {
            fsrs,
            retention_override: None,
        }
    }

    /// Adapter that overrides the retention target for every review it
    /// schedules — pass the deck's `desired_retention` so per-deck tuning
    /// actually reaches FSRS (P006). The value is clamped into the FSRS-safe
    /// band by [`CardScheduler`], so any valid deck value (`[0.5, 0.99]`) is
    /// accepted without erroring.
    pub fn with_retention(fsrs: &'a CardScheduler, retention: f32) -> Self {
        Self {
            fsrs,
            retention_override: Some(retention),
        }
    }

    /// The retention this adapter applies: the per-deck override when set,
    /// otherwise the engine's configured default.
    fn retention(&self) -> f32 {
        self.retention_override
            .unwrap_or_else(|| self.fsrs.desired_retention())
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

        let outcome = self.fsrs.apply_review_with_retention(
            current,
            elapsed_u32,
            rating_enum,
            self.retention(),
        )?;

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
