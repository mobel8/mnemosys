//! Golden tests for the FSRS wrapper.
//!
//! These tests pin down the *contract* of the wrapper:
//! - shape of the API (Rating round-trip, DTO round-trip, error paths)
//! - qualitative invariants of FSRS-6 (Easy >= Good >= Hard >= Again,
//!   higher retention -> shorter intervals, lapses don't increase stability,
//!   difficulty stays in [1, 10], etc.).
//!
//! They intentionally avoid hard-coded numeric expectations on stability /
//! difficulty (those would tie us to a specific `fsrs` patch release).

use super::*;

const EPSILON: f32 = 0.001;

fn approx_eq(a: f32, b: f32) -> bool {
    (a - b).abs() < EPSILON
}

// ---------------------------------------------------------------------------
// Rating
// ---------------------------------------------------------------------------

#[test]
fn rating_from_u8_valid_values() {
    assert!(matches!(Rating::from_u8(1).unwrap(), Rating::Again));
    assert!(matches!(Rating::from_u8(2).unwrap(), Rating::Hard));
    assert!(matches!(Rating::from_u8(3).unwrap(), Rating::Good));
    assert!(matches!(Rating::from_u8(4).unwrap(), Rating::Easy));
}

#[test]
fn rating_from_u8_invalid_returns_error() {
    assert!(Rating::from_u8(0).is_err());
    assert!(Rating::from_u8(5).is_err());
    assert!(Rating::from_u8(255).is_err());
}

#[test]
fn rating_as_u8_round_trip() {
    for n in 1u8..=4 {
        assert_eq!(Rating::from_u8(n).unwrap().as_u8(), n);
    }
}

#[test]
fn ratings_serialize_to_snake_case() {
    assert_eq!(serde_json::to_string(&Rating::Again).unwrap(), "\"again\"");
    assert_eq!(serde_json::to_string(&Rating::Hard).unwrap(), "\"hard\"");
    assert_eq!(serde_json::to_string(&Rating::Good).unwrap(), "\"good\"");
    assert_eq!(serde_json::to_string(&Rating::Easy).unwrap(), "\"easy\"");
}

#[test]
fn rating_deserializes_from_snake_case() {
    let r: Rating = serde_json::from_str("\"good\"").unwrap();
    assert!(matches!(r, Rating::Good));
}

// ---------------------------------------------------------------------------
// CardScheduler::new validation
// ---------------------------------------------------------------------------

#[test]
fn invalid_desired_retention_rejected() {
    assert!(CardScheduler::new(&DEFAULT_PARAMS, 0.5).is_err());
    assert!(CardScheduler::new(&DEFAULT_PARAMS, 0.69).is_err());
    assert!(CardScheduler::new(&DEFAULT_PARAMS, 0.98).is_err());
    assert!(CardScheduler::new(&DEFAULT_PARAMS, 1.0).is_err());
}

#[test]
fn valid_desired_retention_accepted() {
    assert!(CardScheduler::new(&DEFAULT_PARAMS, 0.7).is_ok());
    assert!(CardScheduler::new(&DEFAULT_PARAMS, 0.85).is_ok());
    assert!(CardScheduler::new(&DEFAULT_PARAMS, 0.9).is_ok());
    assert!(CardScheduler::new(&DEFAULT_PARAMS, 0.97).is_ok());
}

#[test]
fn default_scheduler_works() {
    let s = CardScheduler::with_defaults().unwrap();
    assert!(approx_eq(s.desired_retention(), DEFAULT_DESIRED_RETENTION));
    let out = s.apply_review(None, 0, Rating::Good).unwrap();
    assert!(out.scheduled_days >= 1);
}

#[test]
fn default_params_length_matches_fsrs6() {
    // FSRS-6 uses 21 floats. If this ever breaks, the upstream crate
    // changed its expected parameter shape and DEFAULT_PARAMS must follow.
    assert_eq!(DEFAULT_PARAMS.len(), 21);
    assert_eq!(FSRS_VERSION, "6");
}

// ---------------------------------------------------------------------------
// First-review stability shape
// ---------------------------------------------------------------------------

#[test]
fn first_review_again_initializes_low_stability() {
    let s = CardScheduler::with_defaults().unwrap();
    let out = s.apply_review(None, 0, Rating::Again).unwrap();
    // Initial stability for Again ~ w[0] = 0.212
    assert!(
        out.memory.stability < 1.0,
        "stability after Again should be low, got {}",
        out.memory.stability
    );
    assert!(out.memory.difficulty >= 1.0 && out.memory.difficulty <= 10.0);
    assert!(out.scheduled_days >= 1);
}

#[test]
fn first_review_good_creates_reasonable_interval() {
    let s = CardScheduler::with_defaults().unwrap();
    let out = s.apply_review(None, 0, Rating::Good).unwrap();
    // Initial stability for Good ~ w[2] = 2.3065
    assert!(out.memory.stability > 1.0);
    assert!(out.memory.stability < 5.0);
    assert!(out.scheduled_days >= 1);
}

#[test]
fn first_review_easy_creates_long_interval() {
    let s = CardScheduler::with_defaults().unwrap();
    let out = s.apply_review(None, 0, Rating::Easy).unwrap();
    // Initial stability for Easy ~ w[3] = 8.2956 days
    assert!(out.memory.stability > 5.0);
    assert!(out.scheduled_days > 5);
}

// ---------------------------------------------------------------------------
// Ordering invariants (Again <= Hard <= Good <= Easy)
// ---------------------------------------------------------------------------

#[test]
fn easy_creates_longer_interval_than_good() {
    let s = CardScheduler::with_defaults().unwrap();
    let good = s.apply_review(None, 0, Rating::Good).unwrap();
    let easy = s.apply_review(None, 0, Rating::Easy).unwrap();
    assert!(easy.scheduled_days >= good.scheduled_days);
    assert!(easy.memory.stability >= good.memory.stability);
}

#[test]
fn again_creates_shorter_interval_than_hard() {
    let s = CardScheduler::with_defaults().unwrap();
    let again = s.apply_review(None, 0, Rating::Again).unwrap();
    let hard = s.apply_review(None, 0, Rating::Hard).unwrap();
    assert!(again.scheduled_days <= hard.scheduled_days);
}

#[test]
fn next_states_returns_4_ordered_options() {
    let s = CardScheduler::with_defaults().unwrap();
    let ns = s.next_states(None, 0).unwrap();
    let s1 = ns.again.memory.stability;
    let s2 = ns.hard.memory.stability;
    let s3 = ns.good.memory.stability;
    let s4 = ns.easy.memory.stability;
    assert!(s1 <= s2, "again({}) <= hard({})", s1, s2);
    assert!(s2 <= s3, "hard({}) <= good({})", s2, s3);
    assert!(s3 <= s4, "good({}) <= easy({})", s3, s4);
}

#[test]
fn schedule_invariant_good_geq_hard_after_first_review() {
    let s = CardScheduler::with_defaults().unwrap();
    let state = s.apply_review(None, 0, Rating::Good).unwrap();
    let next = s.next_states(Some(state.memory), 5).unwrap();
    assert!(next.good.interval_days >= next.hard.interval_days);
    assert!(next.easy.interval_days >= next.good.interval_days);
}

// ---------------------------------------------------------------------------
// Multi-review behaviour
// ---------------------------------------------------------------------------

#[test]
fn second_review_good_increases_stability() {
    let s = CardScheduler::with_defaults().unwrap();
    let first = s.apply_review(None, 0, Rating::Good).unwrap();
    let second = s.apply_review(Some(first.memory), 5, Rating::Good).unwrap();
    assert!(
        second.memory.stability > first.memory.stability,
        "stability should grow: {} -> {}",
        first.memory.stability,
        second.memory.stability
    );
}

#[test]
fn lapse_after_review_decreases_stability() {
    let s = CardScheduler::with_defaults().unwrap();
    let learned = s.apply_review(None, 0, Rating::Easy).unwrap();
    let lapsed = s
        .apply_review(Some(learned.memory), 7, Rating::Again)
        .unwrap();
    assert!(
        lapsed.memory.stability <= learned.memory.stability,
        "Again should not increase stability: {} -> {}",
        learned.memory.stability,
        lapsed.memory.stability
    );
}

#[test]
fn elapsed_days_in_future_handles_correctly() {
    let s = CardScheduler::with_defaults().unwrap();
    let learned = s.apply_review(None, 0, Rating::Good).unwrap();
    // Reviewed 30 days late on a card scheduled for ~2-3 days
    let after_long = s
        .apply_review(Some(learned.memory), 30, Rating::Good)
        .unwrap();
    assert!(
        after_long.memory.stability > learned.memory.stability,
        "successful review after long delay should still grow stability"
    );
}

#[test]
fn difficulty_clamped_between_1_and_10() {
    let s = CardScheduler::with_defaults().unwrap();
    let mut state: Option<MemoryStateDTO> = None;
    // Hammer Again 10 times — difficulty must stay in [1, 10].
    for i in 0..10 {
        let out = s.apply_review(state, 1, Rating::Again).unwrap();
        assert!(
            out.memory.difficulty >= 1.0 && out.memory.difficulty <= 10.0,
            "iter {}: difficulty out of bounds: {}",
            i,
            out.memory.difficulty
        );
        state = Some(out.memory);
    }
}

#[test]
fn easy_rating_sequence_grows_intervals_monotonically() {
    let s = CardScheduler::with_defaults().unwrap();
    let mut state: Option<MemoryStateDTO> = None;
    let mut prev_stab = 0.0;
    for i in 0..5 {
        let out = s.apply_review(state, 1, Rating::Easy).unwrap();
        assert!(
            out.memory.stability > prev_stab,
            "iter {}: stability did not grow ({} -> {})",
            i,
            prev_stab,
            out.memory.stability
        );
        prev_stab = out.memory.stability;
        state = Some(out.memory);
    }
}

#[test]
fn custom_desired_retention_changes_intervals() {
    let high = CardScheduler::new(&DEFAULT_PARAMS, 0.95).unwrap();
    let normal = CardScheduler::new(&DEFAULT_PARAMS, 0.85).unwrap();
    let out_high = high.apply_review(None, 0, Rating::Good).unwrap();
    let out_normal = normal.apply_review(None, 0, Rating::Good).unwrap();
    // Higher retention target => shorter intervals (less risk).
    assert!(
        out_high.scheduled_days <= out_normal.scheduled_days,
        "high retention ({}) should yield <= interval than normal ({})",
        out_high.scheduled_days,
        out_normal.scheduled_days
    );
}

// ---------------------------------------------------------------------------
// DTO / serde
// ---------------------------------------------------------------------------

#[test]
fn dto_roundtrip_preserves_values() {
    let m = MemoryStateDTO {
        stability: 5.5,
        difficulty: 7.2,
    };
    let fsrs_m = m.to_fsrs();
    let back = MemoryStateDTO::from_fsrs(fsrs_m);
    assert!(approx_eq(back.stability, 5.5));
    assert!(approx_eq(back.difficulty, 7.2));
}

#[test]
fn memory_state_dto_serializes_to_json() {
    let m = MemoryStateDTO {
        stability: 1.5,
        difficulty: 4.0,
    };
    let json = serde_json::to_string(&m).unwrap();
    assert!(json.contains("stability"));
    assert!(json.contains("difficulty"));
    let back: MemoryStateDTO = serde_json::from_str(&json).unwrap();
    assert!(approx_eq(back.stability, 1.5));
    assert!(approx_eq(back.difficulty, 4.0));
}

#[test]
fn next_states_serializes_to_json() {
    let s = CardScheduler::with_defaults().unwrap();
    let ns = s.next_states(None, 0).unwrap();
    let json = serde_json::to_string(&ns).unwrap();
    for key in [
        "again",
        "hard",
        "good",
        "easy",
        "stability",
        "difficulty",
        "interval_days",
    ] {
        assert!(json.contains(key), "json missing `{}`: {}", key, json);
    }
}

#[test]
fn review_outcome_serializes_to_json() {
    let s = CardScheduler::with_defaults().unwrap();
    let out = s.apply_review(None, 0, Rating::Good).unwrap();
    let json = serde_json::to_string(&out).unwrap();
    assert!(json.contains("memory"));
    assert!(json.contains("scheduled_days"));
}

#[test]
fn scheduled_days_is_at_least_one() {
    // Even with Again (which produces an interval < 1 day) we still round up
    // to at least 1 so scheduling logic upstream doesn't have to special-case.
    let s = CardScheduler::with_defaults().unwrap();
    let out = s.apply_review(None, 0, Rating::Again).unwrap();
    assert!(out.scheduled_days >= 1);
}
