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

use std::sync::Mutex;

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

/// P062 — single-entry memo of the last [`CardScheduler::next_states_with_retention`]
/// call. A graded card hits the engine twice in quick succession: the review UI
/// previews the four outcomes (`preview_next_states`), then `submit_review`
/// re-derives them to pick the chosen button — recomputing the same burn/ndarray
/// pass the preview already produced. Caching the last `(inputs) -> outputs`
/// pair turns that second pass into a cheap cache hit. The inputs flow through
/// identically (same `card.stability`/`difficulty` cast, same `elapsed_days`,
/// same per-deck retention), so an exact (bit-for-bit) key match is correct and
/// avoids any float-tolerance fuzziness.
#[derive(Clone)]
struct NextStatesCache {
    /// `None` = brand-new card; bit-pattern of the f32 stability/difficulty so
    /// the key compares exactly regardless of NaN/precision concerns.
    current_bits: Option<(u32, u32)>,
    elapsed_days: u32,
    /// Bit-pattern of the *clamped* retention actually fed to FSRS — two
    /// distinct deck retentions that clamp to the same band must still hit.
    clamped_retention_bits: u32,
    states: NextStatesDTO,
}

/// FSRS scheduler — one instance per process (per parameter set) is enough.
pub struct CardScheduler {
    fsrs: fsrs::FSRS,
    desired_retention: f32,
    /// P062 — memo of the most recent `next_states` computation (see
    /// [`NextStatesCache`]). Behind a `Mutex` for interior mutability since the
    /// scheduler is shared `&self` behind `AppState`'s own mutex.
    next_states_cache: Mutex<Option<NextStatesCache>>,
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
            next_states_cache: Mutex::new(None),
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

    /// FSRS gives degenerate intervals outside `[0.7, 0.97]`. Deck retention
    /// is validated to a *wider* band (`[0.5, 0.99]`) so a learner can ask for
    /// very loose or very tight scheduling — clamp it into the FSRS-safe band
    /// here so a valid deck value never errors at scheduling time (P006).
    pub(crate) fn clamp_retention(retention: f32) -> f32 {
        retention.clamp(0.7, 0.97)
    }

    /// Compute the four possible next states (one per rating).
    /// `current` is `None` for a brand-new card. `elapsed_days` is how many
    /// days have actually passed since the previous review (0 for a new card).
    pub fn next_states(
        &self,
        current: Option<MemoryStateDTO>,
        elapsed_days: u32,
    ) -> AppResult<NextStatesDTO> {
        self.next_states_with_retention(current, elapsed_days, self.desired_retention)
    }

    /// Like [`Self::next_states`] but overrides the retention target for this
    /// one call — used to honour a deck's per-deck `desired_retention` without
    /// rebuilding the shared engine (P006). `retention` is clamped into the
    /// FSRS-safe band via [`Self::clamp_retention`].
    pub fn next_states_with_retention(
        &self,
        current: Option<MemoryStateDTO>,
        elapsed_days: u32,
        retention: f32,
    ) -> AppResult<NextStatesDTO> {
        let clamped = Self::clamp_retention(retention);

        // P062 — build the exact (bit-for-bit) cache key for this call and
        // short-circuit if the previous call (typically the review preview)
        // already computed the very same four states. Avoids a second
        // burn/ndarray pass per graded card.
        let current_bits = current.map(|m| (m.stability.to_bits(), m.difficulty.to_bits()));
        let clamped_retention_bits = clamped.to_bits();
        if let Ok(guard) = self.next_states_cache.lock() {
            if let Some(hit) = guard.as_ref().filter(|c| {
                c.current_bits == current_bits
                    && c.elapsed_days == elapsed_days
                    && c.clamped_retention_bits == clamped_retention_bits
            }) {
                return Ok(hit.states.clone());
            }
        }

        let curr = current.map(|m| m.to_fsrs());
        let ns = self
            .fsrs
            .next_states(curr, clamped, elapsed_days)
            .map_err(|e| AppError::Fsrs(e.to_string()))?;
        let states = NextStatesDTO {
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
        };

        // P062 — memoise this result for the imminent `submit_review` recompute.
        // A poisoned lock just skips the cache (correctness is unaffected; we
        // simply recompute), so we don't propagate the lock error.
        if let Ok(mut guard) = self.next_states_cache.lock() {
            *guard = Some(NextStatesCache {
                current_bits,
                elapsed_days,
                clamped_retention_bits,
                states: states.clone(),
            });
        }

        Ok(states)
    }

    /// Apply a review and return the new memory state + days until next due.
    /// `scheduled_days` is clamped to at least 1 so cards always move forward.
    pub fn apply_review(
        &self,
        current: Option<MemoryStateDTO>,
        elapsed_days: u32,
        rating: Rating,
    ) -> AppResult<ReviewOutcome> {
        self.apply_review_with_retention(current, elapsed_days, rating, self.desired_retention)
    }

    /// Like [`Self::apply_review`] but overrides the retention target for this
    /// one call so a deck's per-deck `desired_retention` actually drives the
    /// scheduled interval (P006). `retention` is clamped into the FSRS-safe
    /// band via [`Self::clamp_retention`].
    pub fn apply_review_with_retention(
        &self,
        current: Option<MemoryStateDTO>,
        elapsed_days: u32,
        rating: Rating,
        retention: f32,
    ) -> AppResult<ReviewOutcome> {
        let ns = self.next_states_with_retention(current, elapsed_days, retention)?;
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
