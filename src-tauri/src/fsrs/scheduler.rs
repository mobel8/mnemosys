//! FSRS scheduler wrapper.
//!
//! Thin, serde-friendly facade around `fsrs::FSRS`. Everything the rest of
//! the backend needs to talk to the FSRS engine goes through here, so the
//! upstream crate's types (which depend on `burn` tensors internally) never
//! leak into command handlers or the IPC boundary.
//!
//! Note: the upstream crate doesn't expose a public `Rating` enum — its
//! `next_states` method returns all four button outcomes at once and the
//! consumer picks one. Our [`Rating`] therefore lives here only and is used
//! to select the right branch out of [`NextStatesDTO`].

use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};

/// User answer for a review session.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Rating {
    Again = 1,
    Hard = 2,
    Good = 3,
    Easy = 4,
}

impl Rating {
    /// Build a `Rating` from the raw integer the frontend sends over IPC.
    pub fn from_u8(n: u8) -> AppResult<Self> {
        match n {
            1 => Ok(Self::Again),
            2 => Ok(Self::Hard),
            3 => Ok(Self::Good),
            4 => Ok(Self::Easy),
            other => Err(AppError::Validation(format!("invalid rating: {}", other))),
        }
    }

    /// Numeric value (1..=4) suitable for persistence in the review log.
    pub fn as_u8(self) -> u8 {
        self as u8
    }
}

/// Serializable copy of [`fsrs::MemoryState`] — what we persist in SQLite
/// and ship through Tauri commands.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct MemoryStateDTO {
    pub stability: f32,
    pub difficulty: f32,
}

impl MemoryStateDTO {
    pub fn from_fsrs(m: fsrs::MemoryState) -> Self {
        Self {
            stability: m.stability,
            difficulty: m.difficulty,
        }
    }

    pub fn to_fsrs(self) -> fsrs::MemoryState {
        fsrs::MemoryState {
            stability: self.stability,
            difficulty: self.difficulty,
        }
    }
}

/// One of the four button outcomes shown in the review preview UI.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct NextStateDTO {
    pub memory: MemoryStateDTO,
    /// Interval suggested by FSRS, in days. May be fractional; round when
    /// scheduling a concrete due-date.
    pub interval_days: f32,
}

/// Preview of all four next states (one per button), ready to be serialized
/// to JSON for the review UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NextStatesDTO {
    pub again: NextStateDTO,
    pub hard: NextStateDTO,
    pub good: NextStateDTO,
    pub easy: NextStateDTO,
}

/// Result of applying a single review.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct ReviewOutcome {
    pub memory: MemoryStateDTO,
    /// Days until the card is next due (>= 1).
    pub scheduled_days: u32,
}

/// FSRS scheduler — one instance per process (per parameter set) is enough.
pub struct CardScheduler {
    fsrs: fsrs::FSRS,
    desired_retention: f32,
}

impl CardScheduler {
    /// Build a scheduler with custom parameters and a custom retention
    /// target. `desired_retention` must be in `[0.7, 0.97]` — outside that
    /// range FSRS gives degenerate intervals.
    pub fn new(params: &[f32], desired_retention: f32) -> AppResult<Self> {
        if !(0.7..=0.97).contains(&desired_retention) {
            return Err(AppError::Validation(format!(
                "desired_retention out of range [0.7, 0.97]: {}",
                desired_retention
            )));
        }
        let fsrs = fsrs::FSRS::new(Some(params)).map_err(|e| AppError::Fsrs(e.to_string()))?;
        Ok(Self {
            fsrs,
            desired_retention,
        })
    }

    /// Convenience: build with FSRS-6 defaults and 90% retention.
    pub fn with_defaults() -> AppResult<Self> {
        Self::new(
            &crate::fsrs::DEFAULT_PARAMS,
            crate::fsrs::params::DEFAULT_DESIRED_RETENTION,
        )
    }

    /// Currently configured retention target.
    pub fn desired_retention(&self) -> f32 {
        self.desired_retention
    }

    /// Compute the four possible next states (one per rating).
    /// `current` is `None` for a brand-new card. `elapsed_days` is how many
    /// days have actually passed since the previous review (0 for a new card).
    pub fn next_states(
        &self,
        current: Option<MemoryStateDTO>,
        elapsed_days: u32,
    ) -> AppResult<NextStatesDTO> {
        let curr = current.map(|m| m.to_fsrs());
        let ns = self
            .fsrs
            .next_states(curr, self.desired_retention, elapsed_days)
            .map_err(|e| AppError::Fsrs(e.to_string()))?;
        Ok(NextStatesDTO {
            again: NextStateDTO {
                memory: MemoryStateDTO::from_fsrs(ns.again.memory),
                interval_days: ns.again.interval,
            },
            hard: NextStateDTO {
                memory: MemoryStateDTO::from_fsrs(ns.hard.memory),
                interval_days: ns.hard.interval,
            },
            good: NextStateDTO {
                memory: MemoryStateDTO::from_fsrs(ns.good.memory),
                interval_days: ns.good.interval,
            },
            easy: NextStateDTO {
                memory: MemoryStateDTO::from_fsrs(ns.easy.memory),
                interval_days: ns.easy.interval,
            },
        })
    }

    /// Apply a review and return the new memory state + days until next due.
    /// `scheduled_days` is clamped to at least 1 so cards always move forward.
    pub fn apply_review(
        &self,
        current: Option<MemoryStateDTO>,
        elapsed_days: u32,
        rating: Rating,
    ) -> AppResult<ReviewOutcome> {
        let ns = self.next_states(current, elapsed_days)?;
        let next = match rating {
            Rating::Again => ns.again,
            Rating::Hard => ns.hard,
            Rating::Good => ns.good,
            Rating::Easy => ns.easy,
        };
        let scheduled_days = next.interval_days.max(1.0).ceil() as u32;
        Ok(ReviewOutcome {
            memory: next.memory,
            scheduled_days,
        })
    }
}
