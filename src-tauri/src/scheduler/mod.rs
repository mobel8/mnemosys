//! Pluggable per-deck schedulers (Vague 4).
//!
//! Mnemosys ships three scheduling algorithms; each deck picks one through
//! its [`crate::db::Deck::scheduler_kind`] column:
//!
//! - **FSRS-6** (default, [`fsrs6_adapter`]) — adaptive, 21-parameter,
//!   predicts retention. Owned by the long-lived
//!   [`crate::fsrs::CardScheduler`] held in [`crate::app_state::AppState`].
//! - **SM-2** ([`sm2`]) — the classic SuperMemo-2 algorithm popularised by
//!   Anki. Deterministic, auditable, no global parameter set.
//! - **Leitner** ([`leitner`]) — 5-box system. Forgiving and very
//!   predictable; convenient for low-stakes decks or beginners.
//!
//! Every algorithm implements [`Scheduler`] which produces a
//! [`SchedulerOutcome`] from the trio `(card, rating, reviewed_at)`. The
//! outcome is then persisted via
//! [`crate::db::cards::CardRepo::update_after_review`] just like the
//! existing FSRS flow — keeping the storage schema unchanged.
//!
//! Cross-algorithm migration (P073): if the learner switches a deck's
//! `scheduler_kind`, the meaning of the `stability` / `difficulty` columns
//! changes (FSRS uses both literally; SM-2 stores the easiness factor in
//! `difficulty`; Leitner the box index; HLR the correct/incorrect counts;
//! MEMORIZE the forgetting rate). Leaving the raw values untouched silently
//! re-interprets nonsense (e.g. an FSRS difficulty of `8.0` read as a Leitner
//! box, or an EF read as a stability in days), producing a wrong first
//! interval. Since planning precision is the product's core value, we instead
//! **convert** the fields at the switch through a single algorithm-agnostic
//! currency — the card's *estimated memory strength in days* — see
//! [`convert_memory_fields`]. The conversion is lossy by nature (the
//! algorithms model memory differently) but it keeps the next interval in the
//! right ballpark instead of arbitrary; a same-algorithm "switch" is a no-op.
//! Learners who want a true fresh start can still reset a card from the UI.

pub mod fsrs6_adapter;
pub mod hlr;
pub mod leitner;
pub mod memorize;
pub mod sm2;

use std::str::FromStr;

use serde::{Deserialize, Serialize};

use crate::db::{Card, CardState};
use crate::error::{AppError, AppResult};

/// Which scheduling algorithm a deck uses.
///
/// Stored in the `decks.scheduler_kind` TEXT column. Serde uses
/// lowercase strings (`"fsrs6"`, `"sm2"`, `"leitner"`, `"hlr"`,
/// `"memorize"`) so the wire format matches what SQLite stores and what
/// the frontend ships.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SchedulerKind {
    #[default]
    Fsrs6,
    Sm2,
    Leitner,
    /// Half-Life Regression (Settles & Meeder 2016 — Duolingo). See [`hlr`].
    Hlr,
    /// Optimal-control spacing (Tabibian et al. 2019). See [`memorize`].
    Memorize,
}

impl SchedulerKind {
    /// Storage representation — matches the values allowed by the CHECK
    /// constraint on `decks.scheduler_kind`.
    pub fn as_str(self) -> &'static str {
        match self {
            SchedulerKind::Fsrs6 => "fsrs6",
            SchedulerKind::Sm2 => "sm2",
            SchedulerKind::Leitner => "leitner",
            SchedulerKind::Hlr => "hlr",
            SchedulerKind::Memorize => "memorize",
        }
    }
}

impl FromStr for SchedulerKind {
    type Err = AppError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "fsrs6" => Ok(SchedulerKind::Fsrs6),
            "sm2" => Ok(SchedulerKind::Sm2),
            "leitner" => Ok(SchedulerKind::Leitner),
            "hlr" => Ok(SchedulerKind::Hlr),
            "memorize" => Ok(SchedulerKind::Memorize),
            other => Err(AppError::Validation(format!(
                "unknown scheduler_kind '{}'",
                other
            ))),
        }
    }
}

/// Outcome of applying a single rating to a card.
///
/// `state` is the new lifecycle bucket the card belongs to (matches the
/// existing [`CardState`] enum so the persisted schema stays untouched).
/// `stability` and `difficulty` are stored verbatim in `cards.stability`
/// and `cards.difficulty`; each algorithm gives them its own meaning:
///
/// - **FSRS-6** — both are the FSRS memory-state floats.
/// - **SM-2** — `stability = 0.0`, `difficulty` holds the *easiness
///   factor* (EF, default 2.5, min 1.3).
/// - **Leitner** — `stability = 0.0`, `difficulty` holds the *box index*
///   `0..=4` cast to `f64`.
///
/// `scheduled_days` is the integer interval (clamped >= 0) used to
/// compute `cards.next_review`. `elapsed_days` is the number of days
/// since the previous review (0 for new cards) and is mainly there for
/// the review-log row downstream.
#[derive(Debug, Clone, Copy)]
pub struct SchedulerOutcome {
    pub state: CardState,
    pub stability: f64,
    pub difficulty: f64,
    pub scheduled_days: i64,
    pub elapsed_days: i64,
}

/// Common interface every per-deck algorithm implements. Implementations
/// must be **pure** with respect to `(card, rating, reviewed_at)` — all
/// the inputs they need to compute the next state live on the [`Card`].
pub trait Scheduler {
    /// Compute the next state for `card` given a `rating` in `1..=4`
    /// (`1=Again`, `2=Hard`, `3=Good`, `4=Easy`) and a unix-seconds
    /// timestamp `reviewed_at`. Implementations validate `rating` and
    /// return `AppError::Validation` if it is out of range.
    fn next_review(&self, card: &Card, rating: u8, reviewed_at: i64)
        -> AppResult<SchedulerOutcome>;

    /// Stable identifier used in logs (`"fsrs6"`, `"sm2"`, `"leitner"`).
    fn name(&self) -> &'static str;

    /// Preview the four possible outcomes (one per rating). The default
    /// implementation runs [`Self::next_review`] four times — algorithms
    /// can override for efficiency but the math has to match.
    fn preview(&self, card: &Card, reviewed_at: i64) -> AppResult<RatingPreview> {
        Ok(RatingPreview {
            again: self.next_review(card, 1, reviewed_at)?,
            hard: self.next_review(card, 2, reviewed_at)?,
            good: self.next_review(card, 3, reviewed_at)?,
            easy: self.next_review(card, 4, reviewed_at)?,
        })
    }
}

/// Four-button preview (matches the UI's "if you press X, next due is …"
/// row). Returned by [`Scheduler::preview`].
#[derive(Debug, Clone, Copy)]
pub struct RatingPreview {
    pub again: SchedulerOutcome,
    pub hard: SchedulerOutcome,
    pub good: SchedulerOutcome,
    pub easy: SchedulerOutcome,
}

/// Build the right [`Scheduler`] for `kind`, borrowing the long-lived
/// FSRS engine when needed. The returned trait object captures the
/// borrow for FSRS-6 (so it can call into the global tensor-backed
/// engine) — for the deterministic SM-2 / Leitner branches the inner
/// value is owned and the lifetime is effectively `'static`.
pub fn from_kind<'a>(
    kind: SchedulerKind,
    fsrs: &'a crate::fsrs::CardScheduler,
) -> Box<dyn Scheduler + 'a> {
    match kind {
        SchedulerKind::Fsrs6 => Box::new(fsrs6_adapter::Fsrs6Adapter::new(fsrs)),
        SchedulerKind::Sm2 => Box::new(sm2::Sm2Scheduler),
        SchedulerKind::Leitner => Box::new(leitner::LeitnerScheduler),
        SchedulerKind::Hlr => Box::new(hlr::HlrScheduler),
        SchedulerKind::Memorize => Box::new(memorize::MemorizeScheduler),
    }
}

/// Same as [`from_kind`] but threads a per-deck `desired_retention` into the
/// FSRS-6 adapter so the deck's own retention target actually drives the
/// scheduled interval (P006).
///
/// Only FSRS-6 consumes `retention`; the deterministic algorithms (SM-2,
/// Leitner, HLR, Memorize) don't model FSRS retention, so they ignore it and
/// behave exactly like [`from_kind`]. `retention` is clamped into the
/// FSRS-safe band by the engine, so any valid deck value is accepted.
pub fn from_kind_with_retention<'a>(
    kind: SchedulerKind,
    fsrs: &'a crate::fsrs::CardScheduler,
    retention: f32,
) -> Box<dyn Scheduler + 'a> {
    match kind {
        SchedulerKind::Fsrs6 => {
            Box::new(fsrs6_adapter::Fsrs6Adapter::with_retention(fsrs, retention))
        }
        SchedulerKind::Sm2 => Box::new(sm2::Sm2Scheduler),
        SchedulerKind::Leitner => Box::new(leitner::LeitnerScheduler),
        SchedulerKind::Hlr => Box::new(hlr::HlrScheduler),
        SchedulerKind::Memorize => Box::new(memorize::MemorizeScheduler),
    }
}

/// Days between `last_review` (unix seconds, may be `None`) and `now`
/// (unix seconds). Clamped to 0 for new cards or future timestamps.
/// Shared by every scheduler so the elapsed-days math stays consistent.
pub(crate) fn elapsed_days_since(last_review: Option<i64>, now: i64) -> i64 {
    match last_review {
        Some(ts) => {
            let secs = (now - ts).max(0);
            secs / 86_400
        }
        None => 0,
    }
}

/// P073 — convert a card's stored `(stability, difficulty)` from one
/// algorithm's semantics to another's at a `scheduler_kind` switch.
///
/// The columns mean different things per algorithm (see the crate-level
/// docs), so reinterpreting them verbatim yields a wrong first interval.
/// We bridge through one algorithm-agnostic quantity — the card's
/// **estimated memory strength in days** (`strength`), i.e. roughly how long
/// the learner can currently go before the card is due again — then re-encode
/// that strength into the target algorithm's fields:
///
/// 1. `from` + `(stability, difficulty, last_interval_days)` → `strength`
///    (days). `last_interval_days` is `cards.scheduled_days`, an
///    algorithm-agnostic day-scale anchor used where the stored floats alone
///    don't carry a day scale (SM-2 EF, Leitner box → its interval).
/// 2. `strength` → target `(stability, difficulty)`.
///
/// Returns the new `(stability, difficulty)` to persist. A same-algorithm
/// switch round-trips to (approximately) the input. The conversion is lossy
/// by nature — algorithms model memory differently — but it keeps the next
/// interval in the right ballpark instead of arbitrary.
///
/// `last_interval_days` is clamped to `>= 1` internally so a never-reviewed
/// card (interval 0) still maps to a finite strength.
pub fn convert_memory_fields(
    from: SchedulerKind,
    to: SchedulerKind,
    stability: Option<f64>,
    difficulty: Option<f64>,
    last_interval_days: i64,
) -> (Option<f64>, Option<f64>) {
    // No-op when the algorithm is unchanged — never perturb a card that
    // didn't actually switch.
    if from == to {
        return (stability, difficulty);
    }

    // Fields are only meaningful once a card has been reviewed; a pristine
    // New card (both None) starts fresh under the target algorithm too.
    if stability.is_none() && difficulty.is_none() {
        return (None, None);
    }

    let anchor_days = (last_interval_days.max(1)) as f64;
    let strength = estimate_strength_days(from, stability, difficulty, anchor_days);
    // Only an FSRS source carries a genuine FSRS difficulty [1, 10]. Every other
    // algorithm stores something else in that column (Leitner: a box index 0..=4;
    // HLR: a lapse count), so forwarding it would let e.g. box 4 masquerade as
    // FSRS difficulty 4.0. Drop it for non-FSRS sources so the target seeds its
    // own neutral difficulty.
    let src_difficulty = if from == SchedulerKind::Fsrs6 {
        difficulty
    } else {
        None
    };
    encode_strength_days(to, strength, src_difficulty)
}

/// Map a source algorithm's stored fields onto an estimated memory strength in
/// days. Mirrors each module's interval math so the estimate matches what the
/// source would actually have scheduled. The result is clamped to a sane band
/// (`[1, 36500]` days) so a degenerate stored value can't poison the target.
fn estimate_strength_days(
    from: SchedulerKind,
    stability: Option<f64>,
    difficulty: Option<f64>,
    anchor_days: f64,
) -> f64 {
    use SchedulerKind::*;

    let raw = match from {
        // FSRS stability is already a day-scale memory strength.
        Fsrs6 => stability.filter(|s| s.is_finite() && *s > 0.0).unwrap_or(anchor_days),
        // SM-2 EF is not a day scale; the card's last interval is the best
        // available strength anchor.
        Sm2 => anchor_days,
        // Leitner: the box interval IS the strength. `difficulty` holds the
        // box index 0..=4 (see leitner.rs `BOX_INTERVALS_DAYS`).
        Leitner => {
            const BOX_INTERVALS_DAYS: [f64; 5] = [1.0, 3.0, 7.0, 14.0, 30.0];
            let box_idx = difficulty
                .filter(|d| d.is_finite() && *d >= 0.0)
                .map(|d| d.round() as usize)
                .unwrap_or(0)
                .min(4);
            BOX_INTERVALS_DAYS[box_idx]
        }
        // HLR: half-life `h = 2^(nb_correct - nb_incorrect + bias)` (see
        // hlr.rs, θ = [+1, -1, +1]). The half-life is the natural strength.
        Hlr => {
            let nb_correct = stability.filter(|v| v.is_finite() && *v >= 0.0).unwrap_or(0.0);
            let nb_incorrect = difficulty.filter(|v| v.is_finite() && *v >= 0.0).unwrap_or(0.0);
            2f64.powf(nb_correct - nb_incorrect + 1.0)
        }
        // MEMORIZE: interval = C/√n with C ≈ 2.7 (see memorize.rs). The current
        // interval (which equals that expression) is the strength.
        Memorize => {
            const INTERVAL_SCALE: f64 = 2.7;
            difficulty
                .filter(|n| n.is_finite() && *n > 0.0)
                .map(|n| INTERVAL_SCALE / n.sqrt())
                .unwrap_or(anchor_days)
        }
    };

    raw.clamp(1.0, 36_500.0)
}

/// Re-encode an estimated memory strength (days) into the target algorithm's
/// `(stability, difficulty)` columns. `src_difficulty` is forwarded so a
/// FSRS→FSRS-difficulty signal can be preserved where it transfers cleanly
/// (currently only used to keep an FSRS difficulty within range).
fn encode_strength_days(
    to: SchedulerKind,
    strength: f64,
    src_difficulty: Option<f64>,
) -> (Option<f64>, Option<f64>) {
    use SchedulerKind::*;

    match to {
        // FSRS: stability is the strength directly. We have no reliable
        // cross-algorithm signal for the FSRS difficulty [1, 10], so seed the
        // neutral midpoint (5.0) unless the source already carried a valid
        // FSRS-range difficulty we can keep.
        Fsrs6 => {
            let difficulty = src_difficulty
                .filter(|d| d.is_finite() && (1.0..=10.0).contains(d))
                .unwrap_or(5.0);
            (Some(strength), Some(difficulty))
        }
        // SM-2: stability unused (0.0); EF can't be inferred from days, so seed
        // the default EF (2.5, see sm2.rs `EF_DEFAULT`). The preserved interval
        // lives in `cards.scheduled_days`, which SM-2 reads as `prev_interval`.
        Sm2 => (Some(0.0), Some(2.5)),
        // Leitner: pick the box whose interval is closest to the strength.
        Leitner => {
            const BOX_INTERVALS_DAYS: [f64; 5] = [1.0, 3.0, 7.0, 14.0, 30.0];
            let box_idx = BOX_INTERVALS_DAYS
                .iter()
                .enumerate()
                .min_by(|(_, a), (_, b)| {
                    (*a - strength)
                        .abs()
                        .partial_cmp(&(*b - strength).abs())
                        .unwrap_or(std::cmp::Ordering::Equal)
                })
                .map(|(i, _)| i)
                .unwrap_or(0);
            (Some(0.0), Some(box_idx as f64))
        }
        // HLR: invert the half-life with zero lapses → nb_correct =
        // log2(strength) - bias (bias = 1.0). Clamp to a non-negative count.
        Hlr => {
            let nb_correct = (strength.log2() - 1.0).max(0.0).round();
            (Some(nb_correct), Some(0.0))
        }
        // MEMORIZE: invert interval = C/√n → n = (C / strength)², clamped into
        // the rate band [0.01, 5.0] (see memorize.rs MIN_RATE/MAX_RATE).
        Memorize => {
            const INTERVAL_SCALE: f64 = 2.7;
            let n = (INTERVAL_SCALE / strength).powi(2).clamp(0.01, 5.0);
            (Some(0.0), Some(n))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kind_round_trips_through_string() {
        for k in [
            SchedulerKind::Fsrs6,
            SchedulerKind::Sm2,
            SchedulerKind::Leitner,
            SchedulerKind::Hlr,
            SchedulerKind::Memorize,
        ] {
            assert_eq!(SchedulerKind::from_str(k.as_str()).unwrap(), k);
        }
    }

    #[test]
    fn unknown_kind_is_a_validation_error() {
        let err = SchedulerKind::from_str("anki21").unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
    }

    #[test]
    fn default_kind_is_fsrs6() {
        assert_eq!(SchedulerKind::default(), SchedulerKind::Fsrs6);
    }

    // ---- P073 cross-algorithm field conversion -----------------------------

    #[test]
    fn convert_same_kind_is_noop() {
        let (s, d) = convert_memory_fields(
            SchedulerKind::Fsrs6,
            SchedulerKind::Fsrs6,
            Some(12.5),
            Some(6.0),
            10,
        );
        assert_eq!(s, Some(12.5));
        assert_eq!(d, Some(6.0));
    }

    #[test]
    fn convert_pristine_new_card_stays_fresh() {
        // A never-reviewed card (no stored fields) must not gain bogus values.
        let (s, d) = convert_memory_fields(
            SchedulerKind::Fsrs6,
            SchedulerKind::Leitner,
            None,
            None,
            0,
        );
        assert_eq!(s, None);
        assert_eq!(d, None);
    }

    #[test]
    fn convert_fsrs_to_leitner_picks_nearest_box() {
        // FSRS stability ≈ 7 days → Leitner box 2 (its interval is 7 days).
        let (stability, difficulty) = convert_memory_fields(
            SchedulerKind::Fsrs6,
            SchedulerKind::Leitner,
            Some(7.0),
            Some(8.0), // FSRS difficulty — ignored by Leitner
            7,
        );
        assert_eq!(stability, Some(0.0));
        assert_eq!(difficulty, Some(2.0));
    }

    #[test]
    fn convert_leitner_to_fsrs_preserves_day_scale() {
        // Leitner box 4 → 30-day interval → FSRS stability ≈ 30 days, neutral
        // difficulty (5.0) since Leitner carries no FSRS difficulty signal.
        let (stability, difficulty) = convert_memory_fields(
            SchedulerKind::Leitner,
            SchedulerKind::Fsrs6,
            Some(0.0),
            Some(4.0),
            30,
        );
        assert_eq!(stability, Some(30.0));
        assert_eq!(difficulty, Some(5.0));
    }

    #[test]
    fn convert_sm2_to_fsrs_uses_last_interval_as_strength() {
        // SM-2 EF is not a day scale; the card's last interval (20 d) anchors
        // the FSRS stability.
        let (stability, _difficulty) = convert_memory_fields(
            SchedulerKind::Sm2,
            SchedulerKind::Fsrs6,
            Some(0.0),
            Some(2.5),
            20,
        );
        assert_eq!(stability, Some(20.0));
    }

    #[test]
    fn convert_target_fields_are_in_band() {
        // Every target must land its difficulty inside that algorithm's valid
        // band, even from a wildly out-of-range source value.
        let sources = SchedulerKind::Fsrs6;
        for to in [
            SchedulerKind::Sm2,
            SchedulerKind::Leitner,
            SchedulerKind::Hlr,
            SchedulerKind::Memorize,
        ] {
            let (s, d) =
                convert_memory_fields(sources, to, Some(99_999.0), Some(999.0), 100_000);
            let s = s.unwrap();
            let d = d.unwrap();
            assert!(s.is_finite() && d.is_finite());
            match to {
                SchedulerKind::Sm2 => assert!((1.3..=4.0).contains(&d)),
                SchedulerKind::Leitner => assert!((0.0..=4.0).contains(&d)),
                SchedulerKind::Hlr => assert!(d >= 0.0),
                SchedulerKind::Memorize => assert!((0.01..=5.0).contains(&d)),
                SchedulerKind::Fsrs6 => unreachable!(),
            }
        }
    }
}
