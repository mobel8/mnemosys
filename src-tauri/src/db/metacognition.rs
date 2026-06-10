//! Metacognition repository — calibration from CBM confidence ratings (v0.11).
//!
//! Source of truth: `reviews.confidence`, the prospective 1-5 confidence the
//! learner gives BEFORE the card is flipped (confidence-based marking,
//! Gardner-Medwin UCL — see `schema_v5.sql`), written by `submit_review`
//! whenever the confidence toggle is on. Each confidence-carrying review is
//! one calibration sample:
//!
//!   - prediction = `(clamp(confidence, 1, 5) - 1) / 4` — the 1-5 scale
//!     mapped linearly onto a probability: 1 → 0.0, 2 → 0.25, 3 → 0.5,
//!     4 → 0.75, 5 → 1.0.
//!   - outcome    = `rating >= 3` (Good/Easy = successful recall, the same
//!     threshold the retention stats use).
//!
//! From those pairs we derive the classical metacognition measures:
//! *resolution* (Goodman-Kruskal γ — does higher confidence rank-order with
//! actual recall?) and *calibration bias* (mean predicted minus mean actual —
//! positive = overconfidence). The statistics are unchanged from the original
//! implementation; only the data source moved.
//!
//! v0.11 — this file previously implemented the delayed-JOL pipeline
//! (Vague 7, `jol_predictions`). That pipeline was stillborn: the prompt that
//! recorded predictions only opened when predictions already existed, so the
//! table could never receive its first row and the dashboard it fed was
//! unreachable. `record_prediction` / `resolve_prediction` /
//! `pending_predictions` are gone; the `jol_predictions` table stays in the
//! DB (inert, no DROP — see `schema_v9.sql`).

use rusqlite::{types::Value, Connection, Row};
use serde::{Deserialize, Serialize};

use crate::error::AppResult;

/// One bucket of the calibration histogram. 10 contiguous bands of width
/// `0.1`: 0.0..0.1, 0.1..0.2, …, 0.9..1.0 (inclusive on the right for the
/// last bucket so `1.0` is not lost). With the discrete 1-5 confidence scale
/// only five bands can be populated (0.0, 0.2, 0.5, 0.7, 0.9 — where the
/// normalised values 0.0 / 0.25 / 0.5 / 0.75 / 1.0 land); the full 10-band
/// axis is kept so the UI renders a stable histogram.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CalibrationBucket {
    /// Lower edge of the band (`0.0`, `0.1`, …, `0.9`).
    pub band: f64,
    /// Mean predicted probability (normalised confidence) inside this band.
    pub predicted: f64,
    /// Empirical recall fraction (`correct / total`) inside this band.
    pub actual: f64,
    /// Number of confidence-carrying reviews inside the band.
    pub count: i64,
}

/// Aggregated calibration stats over the confidence-carrying reviews of a
/// deck (or the whole DB when `deck_id` is None), optionally limited to a
/// trailing period window.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CalibrationStats {
    /// Goodman-Kruskal γ in `[-1.0, 1.0]`. `0.0` when there are <2 unique
    /// confidence values (no concordant/discordant pairs to look at).
    pub gamma: f64,
    /// Mean(predicted) - mean(actual). Positive = overconfidence,
    /// negative = under-confidence.
    pub bias: f64,
    /// Always 10 buckets; band runs `[0.0, 0.1) … [0.9, 1.0]`.
    pub buckets: Vec<CalibrationBucket>,
    /// Total number of reviews carrying a confidence value in scope. The
    /// field name is kept from the JOL era so the dashboard contract
    /// (`total_resolved >= 30` gate) doesn't change.
    pub total_resolved: i64,
}

pub struct MetacognitionRepo<'a> {
    conn: &'a Connection,
}

impl<'a> MetacognitionRepo<'a> {
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }

    /// Calibration stats over reviews that carry a CBM `confidence` value.
    ///
    /// `deck_id` filters to a single deck via the `cards.deck_id` join; pass
    /// `None` for « every deck ». `days` is the stats-page period window
    /// (7/30/90/365): only reviews with `reviewed_at >= now - days*86400`
    /// count; `None` means all-time. Buckets always have 10 entries — empty
    /// bands surface as `count = 0` so the UI can render a stable axis
    /// regardless of how much data is in.
    pub fn calibration_stats(
        &self,
        deck_id: Option<i64>,
        days: Option<u32>,
        now: i64,
    ) -> AppResult<CalibrationStats> {
        // P060 — the calibration dashboard must not SELECT every
        // confidence-carrying review into a Vec just to bucket / average. The
        // O(N) work — bucketing, counts and means — happens in a single
        // GROUP BY in SQLite, and only a bounded random sample
        // (≤ GAMMA_SAMPLE rows) is pulled into memory for the O(K²) γ.
        // Memory is O(buckets + K), not O(N).
        let since = days.map(|d| now - (d as i64) * 86_400);

        // 1) Per-band aggregates straight from SQL.
        let bands = self.confidence_band_aggregates(deck_id, since)?;
        let (buckets, total_resolved, bias) = buckets_and_bias_from_bands(&bands);

        // 2) γ over a bounded random sample.
        let gamma = goodman_kruskal_gamma(&self.confidence_gamma_sample(deck_id, since)?);

        Ok(CalibrationStats {
            gamma,
            bias,
            buckets,
            total_resolved,
        })
    }

    // ---- internals ---------------------------------------------------------

    /// P060 — per-band aggregates for the calibration histogram, computed in
    /// SQLite (`GROUP BY` the 0.1-wide confidence band) so we never
    /// materialise one Rust row per review. Returns at most 10 rows:
    /// `(band_index, count, sum_predicted, sum_correct)`.
    ///
    /// `(MIN(MAX(confidence, 1), 5) - 1) / 4.0` clamps the stored value into
    /// [1, 5] then normalises it to [0, 1]; `band_index` is
    /// `min(floor(normalised * 10), 9)` so `1.0` falls into the last bucket —
    /// the same clamp the JOL-era SQL applied to `predicted_prob`.
    fn confidence_band_aggregates(
        &self,
        deck_id: Option<i64>,
        since: Option<i64>,
    ) -> AppResult<Vec<BandAgg>> {
        let map_row = |row: &Row<'_>| -> rusqlite::Result<BandAgg> {
            Ok(BandAgg {
                band_index: row.get::<_, i64>(0)?.clamp(0, 9) as usize,
                count: row.get(1)?,
                sum_predicted: row.get(2)?,
                sum_correct: row.get(3)?,
            })
        };
        let (scope, params) = confidence_scope(deck_id, since);
        let sql = format!(
            "SELECT MIN(CAST((MIN(MAX(r.confidence, 1), 5) - 1) / 4.0 * 10 AS INTEGER), 9) AS band,
                    COUNT(*),
                    SUM((MIN(MAX(r.confidence, 1), 5) - 1) / 4.0),
                    SUM(CASE WHEN r.rating >= 3 THEN 1 ELSE 0 END)
             FROM reviews r{scope}
             GROUP BY band"
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let mut out = Vec::new();
        for r in stmt.query_map(rusqlite::params_from_iter(params.iter()), map_row)? {
            out.push(r?);
        }
        Ok(out)
    }

    /// P060 — a bounded uniform random sample of `(predicted, correct)` pairs
    /// for the O(K²) γ. `ORDER BY RANDOM() LIMIT GAMMA_SAMPLE` does the
    /// sampling in SQLite, so we pull at most `GAMMA_SAMPLE` rows into memory
    /// instead of the whole table. When the confidence-carrying set is
    /// already ≤ GAMMA_SAMPLE this returns every row (the sort is a
    /// no-op-sized heap), so the γ is exact for small histories.
    fn confidence_gamma_sample(
        &self,
        deck_id: Option<i64>,
        since: Option<i64>,
    ) -> AppResult<Vec<(f64, bool)>> {
        let map_row = |row: &Row<'_>| -> rusqlite::Result<(f64, bool)> {
            let c: i64 = row.get(0)?;
            let rating: i64 = row.get(1)?;
            // Clamp defensively: a stray out-of-range value can't push the
            // normalised confidence outside [0, 1].
            let norm = ((c.clamp(1, 5) - 1) as f64) / 4.0;
            Ok((norm, rating >= 3))
        };
        let (scope, mut params) = confidence_scope(deck_id, since);
        params.push(Value::Integer(GAMMA_SAMPLE));
        let sql = format!(
            "SELECT r.confidence, r.rating
             FROM reviews r{scope}
             ORDER BY RANDOM() LIMIT ?{}",
            params.len()
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let mut out = Vec::new();
        for r in stmt.query_map(rusqlite::params_from_iter(params.iter()), map_row)? {
            out.push(r?);
        }
        Ok(out)
    }
}

/// Compose the optional deck / period filters shared by the two calibration
/// queries. Returns the SQL tail to append after `FROM reviews r` (JOIN +
/// WHERE, starting with a space) and the positional `Value`s backing its `?N`
/// placeholders, in order. The `cards` JOIN is only emitted when a deck
/// filter is present, so the unfiltered (most common) query stays a single
/// table scan.
fn confidence_scope(deck_id: Option<i64>, since: Option<i64>) -> (String, Vec<Value>) {
    let mut sql = String::new();
    let mut params: Vec<Value> = Vec::new();
    if deck_id.is_some() {
        sql.push_str(" INNER JOIN cards c ON c.id = r.card_id");
    }
    sql.push_str(" WHERE r.confidence IS NOT NULL");
    if let Some(deck_id) = deck_id {
        params.push(Value::Integer(deck_id));
        sql.push_str(&format!(" AND c.deck_id = ?{}", params.len()));
    }
    if let Some(since) = since {
        params.push(Value::Integer(since));
        sql.push_str(&format!(" AND r.reviewed_at >= ?{}", params.len()));
    }
    (sql, params)
}

/// P060 — one row of the SQL `GROUP BY band` aggregate: how many
/// confidence-carrying reviews landed in this 0.1-wide band, plus the running
/// sums the dashboard needs (mean predicted, empirical recall).
struct BandAgg {
    band_index: usize,
    count: i64,
    sum_predicted: f64,
    sum_correct: i64,
}

/// P060 — fold the (≤ 10) SQL band aggregates into the always-10-entry bucket
/// histogram, the total sample count, and the global bias = mean(predicted) -
/// mean(actual). Empty bands surface as `count = 0` so the UI axis stays
/// stable. Bias is `0.0` when there is no data.
fn buckets_and_bias_from_bands(bands: &[BandAgg]) -> (Vec<CalibrationBucket>, i64, f64) {
    let mut buckets: Vec<CalibrationBucket> = (0..10)
        .map(|i| CalibrationBucket {
            band: (i as f64) / 10.0,
            predicted: 0.0,
            actual: 0.0,
            count: 0,
        })
        .collect();

    let mut total: i64 = 0;
    let mut sum_predicted = 0.0;
    let mut sum_correct: i64 = 0;
    for agg in bands {
        let b = &mut buckets[agg.band_index];
        b.count = agg.count;
        if agg.count > 0 {
            b.predicted = agg.sum_predicted / agg.count as f64;
            b.actual = agg.sum_correct as f64 / agg.count as f64;
        }
        total += agg.count;
        sum_predicted += agg.sum_predicted;
        sum_correct += agg.sum_correct;
    }

    let bias = if total == 0 {
        0.0
    } else {
        sum_predicted / total as f64 - sum_correct as f64 / total as f64
    };
    (buckets, total, bias)
}

/// P060 — the maximum number of `(predicted, correct)` pairs pulled into
/// memory for a γ computation. The caller samples this many rows in SQL
/// (`ORDER BY RANDOM() LIMIT GAMMA_SAMPLE`), so the O(K²) pair scan below
/// runs against a bounded slice and a learner with tens of thousands of
/// confidence-carrying reviews neither allocates a huge Vec nor stalls the
/// stats dashboard.
const GAMMA_SAMPLE: i64 = 500;

/// Goodman-Kruskal γ over `(predicted, actual)` pairs.
///
/// γ = (Nc - Nd) / (Nc + Nd)
///
/// where Nc = concordant pairs (predicted_i > predicted_j AND actual_i > actual_j),
///       Nd = discordant pairs (predicted_i > predicted_j AND actual_i < actual_j).
/// Ties on either dimension are ignored — the classical formula.
///
/// Returns `0.0` when there are no informative pairs. The input is expected to
/// be already bounded to at most [`GAMMA_SAMPLE`] pairs (sampling happens in
/// SQL, see [`MetacognitionRepo::confidence_gamma_sample`]), so this operates
/// directly on the borrowed slice with no allocation — O(K²) over a fixed K.
fn goodman_kruskal_gamma(pairs: &[(f64, bool)]) -> f64 {
    if pairs.len() < 2 {
        return 0.0;
    }

    let mut nc: i64 = 0;
    let mut nd: i64 = 0;
    for i in 0..pairs.len() {
        for j in (i + 1)..pairs.len() {
            let (pi, ai) = pairs[i];
            let (pj, aj) = pairs[j];
            if (pi - pj).abs() < f64::EPSILON {
                continue; // tied on prediction
            }
            if ai == aj {
                continue; // tied on outcome (both correct or both incorrect)
            }
            let p_higher = pi > pj;
            let a_higher = ai && !aj; // ai = true > aj = false
            if p_higher == a_higher {
                nc += 1;
            } else {
                nd += 1;
            }
        }
    }
    if nc + nd == 0 {
        return 0.0;
    }
    (nc - nd) as f64 / (nc + nd) as f64
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::cards::CardState;
    use crate::db::notes::NoteTemplate;
    use crate::db::reviews::NewReview;
    use crate::db::Database;
    use rusqlite::params;
    use serde_json::json;

    const DAY: i64 = 86_400;
    const NOW: i64 = 1_700_000_000;

    /// Insert one deck + note + card; returns `(deck_id, card_id)`.
    fn seed_card_in_deck(db: &Database, name: &str) -> (i64, i64) {
        let conn = db.lock();
        let deck = db
            .decks(&conn)
            .create(name, None, "#3b82f6", 0.9, None, None, None)
            .unwrap();
        let note = db
            .notes(&conn)
            .create(
                deck.id,
                NoteTemplate::Basic,
                json!({ "front": "f", "back": "b" }),
                vec![],
                None,
            )
            .unwrap();
        let card_id = conn
            .query_row(
                "SELECT id FROM cards WHERE note_id = ?1",
                params![note.id],
                |r| r.get(0),
            )
            .unwrap();
        (deck.id, card_id)
    }

    fn seed_card(db: &Database) -> i64 {
        seed_card_in_deck(db, "D").1
    }

    /// Append a review carrying an optional prospective CBM `confidence`
    /// (1-5, what `submit_review` writes when the confidence toggle is on)
    /// and an FSRS `rating` (1-4). The repo layer does not validate the
    /// confidence range (that happens at the command layer), which lets the
    /// clamping test push out-of-range values through the real write path.
    fn add_review(db: &Database, card_id: i64, rating: i64, confidence: Option<i64>, at: i64) {
        let conn = db.lock();
        db.reviews(&conn)
            .insert(
                NewReview {
                    card_id,
                    rating,
                    state_before: CardState::Review,
                    state_after: CardState::Review,
                    stability_before: Some(5.0),
                    stability_after: 5.0,
                    difficulty_before: Some(5.0),
                    difficulty_after: 5.0,
                    elapsed_days: 1,
                    scheduled_days: 5,
                    review_time: 1_000,
                    confidence,
                    // Legacy column — v0.11 stopped writing it; stays None.
                    confidence_post: None,
                },
                at,
            )
            .unwrap();
    }

    #[test]
    fn calibration_empty_returns_zeroes() {
        let db = Database::for_test();
        seed_card(&db);
        let conn = db.lock();
        let stats = MetacognitionRepo::new(&conn)
            .calibration_stats(None, None, NOW)
            .unwrap();
        assert_eq!(stats.total_resolved, 0);
        assert_eq!(stats.gamma, 0.0);
        assert_eq!(stats.bias, 0.0);
        assert_eq!(stats.buckets.len(), 10);
        assert!(stats.buckets.iter().all(|b| b.count == 0));
    }

    /// High confidence (5) lines up with Good/Easy and low confidence (1)
    /// with Again — a perfectly resolved learner: γ ≈ 1.0, bias ≈ 0.
    #[test]
    fn calibration_from_cbm_confidence_perfect_correlation() {
        let db = Database::for_test();
        let card_id = seed_card(&db);
        let mut t = NOW;
        for _ in 0..6 {
            add_review(&db, card_id, 4, Some(5), t); // confident + correct
            t += 100;
            add_review(&db, card_id, 1, Some(1), t); // unsure + wrong
            t += 100;
        }

        let conn = db.lock();
        let stats = MetacognitionRepo::new(&conn)
            .calibration_stats(None, None, NOW + DAY)
            .unwrap();
        assert_eq!(stats.total_resolved, 12, "every review carries confidence");
        assert!(
            (stats.gamma - 1.0).abs() < 1e-9,
            "expected γ ≈ 1.0, got {}",
            stats.gamma
        );
        // Mean predicted = (6×1.0 + 6×0.0)/12 = 0.5 = mean actual (6/12).
        assert!(
            stats.bias.abs() < 1e-9,
            "expected near-zero bias, got {}",
            stats.bias
        );
        // Confidence 5 → band 0.9 (predicted 1.0); confidence 1 → band 0.0.
        let top = &stats.buckets[9];
        assert_eq!(top.count, 6);
        assert!((top.predicted - 1.0).abs() < 1e-9);
        assert!((top.actual - 1.0).abs() < 1e-9);
        let bottom = &stats.buckets[0];
        assert_eq!(bottom.count, 6);
        assert!(bottom.predicted.abs() < 1e-9);
        assert!(bottom.actual.abs() < 1e-9);
    }

    /// Confidently wrong + hesitantly right — the inverse learner: γ ≈ -1.0.
    #[test]
    fn calibration_gamma_inverse_for_confident_wrong() {
        let db = Database::for_test();
        let card_id = seed_card(&db);
        let mut t = NOW;
        for _ in 0..3 {
            add_review(&db, card_id, 1, Some(5), t); // confident + wrong
            t += 100;
            add_review(&db, card_id, 4, Some(1), t); // unsure + correct
            t += 100;
        }

        let conn = db.lock();
        let stats = MetacognitionRepo::new(&conn)
            .calibration_stats(None, None, NOW + DAY)
            .unwrap();
        assert_eq!(stats.total_resolved, 6);
        assert!(
            (stats.gamma + 1.0).abs() < 1e-9,
            "expected γ ≈ -1.0, got {}",
            stats.gamma
        );
        // Mean predicted = 0.5 = mean actual → bias still ≈ 0 even though the
        // rank correlation is fully inverted (bias and resolution are
        // independent failure modes).
        assert!(stats.bias.abs() < 1e-9);
    }

    /// Always maximally confident but mostly wrong → strong positive bias.
    /// All predictions tie, so γ has no informative pairs and stays 0.
    #[test]
    fn calibration_bias_detects_overconfidence() {
        let db = Database::for_test();
        let card_id = seed_card(&db);
        add_review(&db, card_id, 4, Some(5), NOW);
        add_review(&db, card_id, 1, Some(5), NOW + 100);
        add_review(&db, card_id, 1, Some(5), NOW + 200);
        add_review(&db, card_id, 1, Some(5), NOW + 300);

        let conn = db.lock();
        let stats = MetacognitionRepo::new(&conn)
            .calibration_stats(None, None, NOW + DAY)
            .unwrap();
        assert_eq!(stats.total_resolved, 4);
        // Predicted 1.0 everywhere, actual 1/4 → bias = +0.75.
        assert!(
            (stats.bias - 0.75).abs() < 1e-9,
            "expected bias ≈ +0.75, got {}",
            stats.bias
        );
        assert_eq!(
            stats.gamma, 0.0,
            "all-tied predictions carry no rank signal"
        );
        let top = &stats.buckets[9];
        assert_eq!(top.count, 4);
        assert!((top.actual - 0.25).abs() < 1e-9);
    }

    /// Pin the 1-5 → band mapping: 1→0.0, 2→0.2, 3→0.5, 4→0.7, 5→0.9
    /// (normalised 0.0 / 0.25 / 0.5 / 0.75 / 1.0 truncated to 0.1 bands).
    #[test]
    fn buckets_pin_the_five_confidence_levels() {
        let db = Database::for_test();
        let card_id = seed_card(&db);
        let mut t = NOW;
        for confidence in 1..=5_i64 {
            add_review(&db, card_id, 3, Some(confidence), t);
            t += 100;
        }

        let conn = db.lock();
        let stats = MetacognitionRepo::new(&conn)
            .calibration_stats(None, None, NOW + DAY)
            .unwrap();
        assert_eq!(stats.total_resolved, 5);
        let expected: [(usize, f64); 5] = [(0, 0.0), (2, 0.25), (5, 0.5), (7, 0.75), (9, 1.0)];
        for (band_index, predicted) in expected {
            let b = &stats.buckets[band_index];
            assert_eq!(b.count, 1, "band {band_index} must hold exactly one review");
            assert!(
                (b.predicted - predicted).abs() < 1e-9,
                "band {band_index}: expected predicted {predicted}, got {}",
                b.predicted
            );
        }
        let populated: i64 = stats.buckets.iter().map(|b| b.count).sum();
        assert_eq!(populated, 5, "no review may leak into another band");
    }

    /// Reviews without a confidence value (toggle off) are invisible to the
    /// calibration — only CBM-rated reviews feed the stats.
    #[test]
    fn reviews_without_confidence_are_excluded() {
        let db = Database::for_test();
        let card_id = seed_card(&db);
        add_review(&db, card_id, 4, None, NOW);
        add_review(&db, card_id, 1, None, NOW + 100);
        add_review(&db, card_id, 3, Some(3), NOW + 200);

        let conn = db.lock();
        let stats = MetacognitionRepo::new(&conn)
            .calibration_stats(None, None, NOW + DAY)
            .unwrap();
        assert_eq!(stats.total_resolved, 1);
        assert_eq!(stats.buckets[5].count, 1);
        // Single sample: predicted 0.5, correct (rating 3) → bias = -0.5.
        assert!((stats.bias - (0.5 - 1.0)).abs() < 1e-9);
    }

    /// The period window (stats-page selector: 7/30/90/365 days) only counts
    /// reviews inside `now - days*86400`; `None` is all-time.
    #[test]
    fn calibration_respects_period_window() {
        let db = Database::for_test();
        let card_id = seed_card(&db);
        add_review(&db, card_id, 4, Some(5), NOW - 40 * DAY); // outside 30 d
        add_review(&db, card_id, 1, Some(1), NOW - DAY); // inside 30 d

        let conn = db.lock();
        let meta = MetacognitionRepo::new(&conn);

        let windowed = meta.calibration_stats(None, Some(30), NOW).unwrap();
        assert_eq!(windowed.total_resolved, 1);
        assert_eq!(
            windowed.buckets[0].count, 1,
            "only the recent low-confidence review"
        );
        assert_eq!(
            windowed.buckets[9].count, 0,
            "the 40-day-old review is out of window"
        );

        let all_time = meta.calibration_stats(None, None, NOW).unwrap();
        assert_eq!(all_time.total_resolved, 2);

        let year = meta.calibration_stats(None, Some(365), NOW).unwrap();
        assert_eq!(year.total_resolved, 2);
    }

    /// The deck filter joins through `cards.deck_id` and must not leak
    /// another deck's reviews.
    #[test]
    fn calibration_filters_by_deck() {
        let db = Database::for_test();
        let (deck_a, card_a) = seed_card_in_deck(&db, "A");
        let (_deck_b, card_b) = seed_card_in_deck(&db, "B");
        add_review(&db, card_a, 4, Some(5), NOW);
        add_review(&db, card_b, 1, Some(1), NOW + 100);

        let conn = db.lock();
        let meta = MetacognitionRepo::new(&conn);

        let only_a = meta
            .calibration_stats(Some(deck_a), None, NOW + DAY)
            .unwrap();
        assert_eq!(only_a.total_resolved, 1);
        assert_eq!(only_a.buckets[9].count, 1);
        assert_eq!(
            only_a.buckets[0].count, 0,
            "deck B's review must not leak in"
        );
        // Predicted 1.0, correct → bias = 0.0 for deck A alone.
        assert!(only_a.bias.abs() < 1e-9);

        let both = meta.calibration_stats(None, None, NOW + DAY).unwrap();
        assert_eq!(both.total_resolved, 2);
    }

    /// Out-of-range confidence values (no CHECK on the v5 column) are clamped
    /// into [1, 5] by both the SQL aggregation and the Rust γ sample, so a
    /// stray row can't push a prediction outside [0, 1].
    #[test]
    fn out_of_range_confidence_is_clamped() {
        let db = Database::for_test();
        let card_id = seed_card(&db);
        add_review(&db, card_id, 4, Some(9), NOW); // clamps to 5 → 1.0
        add_review(&db, card_id, 1, Some(0), NOW + 100); // clamps to 1 → 0.0

        let conn = db.lock();
        let stats = MetacognitionRepo::new(&conn)
            .calibration_stats(None, None, NOW + DAY)
            .unwrap();
        assert_eq!(stats.total_resolved, 2);
        let top = &stats.buckets[9];
        assert_eq!(top.count, 1);
        assert!((top.predicted - 1.0).abs() < 1e-9, "9 must clamp to 1.0");
        let bottom = &stats.buckets[0];
        assert_eq!(bottom.count, 1);
        assert!(bottom.predicted.abs() < 1e-9, "0 must clamp to 0.0");
        // The clamped pair is perfectly concordant → γ = 1.0 (exercises the
        // Rust-side clamp in the γ sample as well).
        assert!((stats.gamma - 1.0).abs() < 1e-9);
    }

    #[test]
    fn gamma_returns_one_for_perfect_correlation() {
        // High predictions → correct, low predictions → incorrect.
        let pairs = vec![(0.9, true), (0.8, true), (0.2, false), (0.1, false)];
        let g = goodman_kruskal_gamma(&pairs);
        assert!((g - 1.0).abs() < 1e-9, "expected γ ≈ 1.0, got {}", g);
    }

    #[test]
    fn gamma_returns_minus_one_for_inverse_correlation() {
        // High predictions → incorrect (the classic « confident-wrong »).
        let pairs = vec![(0.9, false), (0.8, false), (0.2, true), (0.1, true)];
        let g = goodman_kruskal_gamma(&pairs);
        assert!((g + 1.0).abs() < 1e-9, "expected γ ≈ -1.0, got {}", g);
    }

    #[test]
    fn gamma_returns_zero_on_insufficient_data() {
        assert_eq!(goodman_kruskal_gamma(&[]), 0.0);
        assert_eq!(goodman_kruskal_gamma(&[(0.5, true)]), 0.0);
    }
}
