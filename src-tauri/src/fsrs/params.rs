//! FSRS-6 default parameters and constants.
//!
//! The upstream `fsrs` 5.2 crate's algorithm targets FSRS-6 (it ships
//! `FSRS6_DEFAULT_DECAY = 0.1542` as parameter 21 of the default weights).
//! The 21 floats below are the calibrated defaults trained on ~700M reviews
//! (see `fsrs::DEFAULT_PARAMETERS`); we redeclare them here so callers don't
//! have to depend on the upstream constant and to give us a single source of
//! truth that the rest of the backend can rely on.

/// FSRS-6 default parameters (21 floats).
pub const DEFAULT_PARAMS: [f32; 21] = [
    0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835,
    0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
];

/// FSRS algorithm version implemented by the `fsrs` 5.2 crate.
pub const FSRS_VERSION: &str = "6";

/// Default desired retention (0.9 == 90% recall target).
pub const DEFAULT_DESIRED_RETENTION: f32 = 0.9;
