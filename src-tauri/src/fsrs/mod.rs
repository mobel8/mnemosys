//! FSRS-6 scheduler wrapper.
//!
//! Built on top of the upstream `fsrs` 5.2 crate. The wrapper exists so the
//! rest of the backend (commands, DB layer, IPC payloads) only ever talks
//! to plain serde-friendly DTOs and never touches `burn`/`ndarray` types
//! directly.
//!
//! Public surface:
//! - [`DEFAULT_PARAMS`] / [`FSRS_VERSION`] / [`DEFAULT_DESIRED_RETENTION`]
//! - [`CardScheduler`] — `new`, `with_defaults`, `next_states`, `apply_review`
//! - DTOs: [`MemoryStateDTO`], [`NextStatesDTO`], [`NextStateDTO`],
//!   [`ReviewOutcome`], [`Rating`]

pub mod optimize;
pub mod params;
pub mod scheduler;

#[cfg(test)]
mod tests;

pub use optimize::{optimize_params_from_history, MIN_REVIEWS_FOR_OPTIM};
pub use params::{DEFAULT_DESIRED_RETENTION, DEFAULT_PARAMS, FSRS_VERSION};
pub use scheduler::{
    CardScheduler, MemoryStateDTO, NextStateDTO, NextStatesDTO, Rating, ReviewOutcome,
};
