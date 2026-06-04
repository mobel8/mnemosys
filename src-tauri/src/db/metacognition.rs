//! Metacognition repository — delayed Judgments of Learning (Vague 7).
//!
//! The headline scientific result: Rhodes & Tauber 2011 meta-analysis (4554
//! subjects) reports a Goodman-Kruskal γ ≈ 0.93 effect size on the
//! *resolution* of delayed JOLs — the rank-order correlation between
//! predicted recall probability and actual recall outcome. Calibration is
//! how far predictions drift away from outcomes in absolute terms (mean
//! predicted minus mean actual).
//!
//! Schema (see `schema_v9.sql`):
//!   - One row per learner self-prediction (`record_prediction`).
//!   - `actual_correct` stays NULL until the first review of the same card
//!     that happens AT OR AFTER the prediction horizon flips it to 0/1
//!     (`resolve_prediction`). P058 — a review before the horizon does not
//!     resolve the JOL: "je m'en souviendrai dans 7 jours" must be scored
//!     against a delayed recall, never an immediate one, or the calibration
//!     γ/bias it feeds is corrupted.
//!   - `pending_predictions` filters by both « unresolved » and « at
//!     least N minutes old » so the UI can fire a delayed prompt without
//!     scanning the full history.

use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

/// One learner self-prediction. Maps 1-1 to `jol_predictions`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JolPrediction {
    pub id: i64,
    pub card_id: i64,
    /// Unix seconds when the JOL was given.
    pub predicted_at: i64,
    /// Learner's predicted recall probability `[0.0, 1.0]`.
    pub predicted_prob: f64,
    /// « Predict for X days from now ». Default 7 (Rhodes & Tauber's pivot).
    pub prediction_horizon_days: i64,
    /// `Some(true)` = next review was Good/Easy. `Some(false)` = Again/Hard.
    /// `None` until [`MetacognitionRepo::resolve_prediction`] has run.
    pub actual_correct: Option<bool>,
    pub resolved_at: Option<i64>,
}

/// One bucket of the calibration histogram. 10 contiguous bands of width
/// `0.1`: 0.0..0.1, 0.1..0.2, …, 0.9..1.0 (inclusive on the right for the
/// last bucket so `1.0` is not lost).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CalibrationBucket {
    /// Lower edge of the band (`0.0`, `0.1`, …, `0.9`).
    pub band: f64,
    /// Mean predicted probability inside this band.
    pub predicted: f64,
    /// Empirical recall fraction (`correct / total`) inside this band.
    pub actual: f64,
    /// Number of resolved predictions inside the band.
    pub count: i64,
}

/// Aggregated calibration stats over the resolved predictions of a deck (or
/// the whole DB when `deck_id` is None).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CalibrationStats {
    /// Goodman-Kruskal γ in `[-1.0, 1.0]`. `0.0` when there are <2 unique
    /// predicted values (no concordant/discordant pairs to look at).
    pub gamma: f64,
    /// Mean(predicted) - mean(actual). Positive = overconfidence,
    /// negative = under-confidence.
    pub bias: f64,
    /// Always 10 buckets; band runs `[0.0, 0.1) … [0.9, 1.0]`.
    pub buckets: Vec<CalibrationBucket>,
    /// Total number of resolved predictions feeding the prospective stats.
    pub total_resolved: i64,

    // --- Vague 22 — retrospective calibration (Bang & Fleming 2018) ---------
    /// Retrospective Goodman-Kruskal γ computed from `reviews.confidence_post`
    /// (the 1-5 confidence captured *after* the answer is revealed, normalised
    /// to `[0, 1]`) against whether that same review was graded Good/Easy
    /// (`rating >= 3`). `None` when fewer than [`RETRO_MIN_SAMPLE`] reviews
    /// carry a post-confidence value — the signal would be too noisy to show.
    pub gamma_post: Option<f64>,
    /// Retrospective bias: mean(confidence_post normalised) - mean(correct).
    /// Positive = retrospective overconfidence. `None` under the same
    /// minimum-sample gate as [`Self::gamma_post`].
    pub bias_post: Option<f64>,
    /// Number of reviews carrying a `confidence_post` value (the retrospective
    /// sample size). `0` when the two-step confidence toggle has never fired.
    pub total_post: i64,
}

/// Minimum number of post-confidence reviews before the retrospective γ/bias
/// are reported. Below this the rank correlation is dominated by noise, so we
/// return `None` and the dashboard hides the second line.
const RETRO_MIN_SAMPLE: i64 = 10;

pub struct MetacognitionRepo<'a> {
    conn: &'a Connection,
}

impl<'a> MetacognitionRepo<'a> {
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }

    /// Insert one prediction. Returns the freshly minted row (including the
    /// auto-incremented `id`). `predicted_prob` must already be clamped to
    /// `[0.0, 1.0]` by the caller.
    pub fn record_prediction(
        &self,
        card_id: i64,
        predicted_prob: f64,
        prediction_horizon_days: i64,
        now: i64,
    ) -> AppResult<JolPrediction> {
        if !(0.0..=1.0).contains(&predicted_prob) {
            return Err(AppError::Validation(format!(
                "predicted_prob must be in [0.0, 1.0] (got {})",
                predicted_prob
            )));
        }
        if prediction_horizon_days <= 0 {
            return Err(AppError::Validation(format!(
                "prediction_horizon_days must be positive (got {})",
                prediction_horizon_days
            )));
        }
        self.conn.execute(
            "INSERT INTO jol_predictions
                (card_id, predicted_at, predicted_prob, prediction_horizon_days)
             VALUES (?1, ?2, ?3, ?4)",
            params![card_id, now, predicted_prob, prediction_horizon_days],
        )?;
        let id = self.conn.last_insert_rowid();
        Ok(JolPrediction {
            id,
            card_id,
            predicted_at: now,
            predicted_prob,
            prediction_horizon_days,
            actual_correct: None,
            resolved_at: None,
        })
    }

    /// Resolve the OLDEST unresolved prediction for `card_id` against the
    /// observed outcome. Used by `submit_review` as a best-effort hook;
    /// returns the number of rows updated (0 when nothing matched).
    ///
    /// P058 — a delayed JOL only carries signal once its prediction *horizon*
    /// has elapsed. « Je m'en souviendrai dans 7 jours » must not be resolved
    /// by a review 2 minutes later: that outcome measures immediate recall, not
    /// the delayed recall the learner predicted, and feeding it into
    /// `actual_correct` corrupts the γ/bias calibration the feature exists to
    /// compute. So we only resolve the oldest prediction whose horizon has
    /// already passed (`now >= predicted_at + horizon * 86400`). Predictions
    /// still inside their horizon stay pending and are picked up by the first
    /// review at or after the horizon. `actual_correct` therefore only ever
    /// holds a genuine post-horizon outcome — calibration needs no extra
    /// filtering downstream.
    pub fn resolve_prediction(&self, card_id: i64, correct: bool, now: i64) -> AppResult<usize> {
        // SQLite has no « UPDATE … LIMIT 1 » without a subselect, so we do
        // the lookup explicitly. Cheap thanks to the partial index on
        // `actual_correct IS NULL`. The `predicted_at + horizon*86400 <= now`
        // guard excludes predictions whose delay window hasn't elapsed yet.
        let oldest_id: Option<i64> = self
            .conn
            .query_row(
                "SELECT id FROM jol_predictions
                 WHERE card_id = ?1 AND actual_correct IS NULL
                   AND predicted_at + prediction_horizon_days * 86400 <= ?2
                 ORDER BY predicted_at ASC
                 LIMIT 1",
                params![card_id, now],
                |r| r.get(0),
            )
            .or_else(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => Ok(None),
                _ => Err(e),
            })?
            .map(Some)
            .unwrap_or(None);
        let Some(id) = oldest_id else {
            return Ok(0);
        };
        let n = self.conn.execute(
            "UPDATE jol_predictions
             SET actual_correct = ?1, resolved_at = ?2
             WHERE id = ?3",
            params![correct as i64, now, id],
        )?;
        Ok(n)
    }

    /// Predictions that are still unresolved AND were given at least
    /// `min_age_minutes` ago. Newest unresolved first (so a learner with
    /// many pending JOLs sees the most recent — most actionable — first).
    pub fn pending_predictions(
        &self,
        min_age_minutes: u32,
        limit: u32,
        now: i64,
    ) -> AppResult<Vec<JolPrediction>> {
        let cutoff = now - (min_age_minutes as i64) * 60;
        let mut stmt = self.conn.prepare(
            "SELECT id, card_id, predicted_at, predicted_prob, prediction_horizon_days,
                    actual_correct, resolved_at
             FROM jol_predictions
             WHERE actual_correct IS NULL AND predicted_at <= ?1
             ORDER BY predicted_at DESC
             LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![cutoff, limit as i64], row_to_jol)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    /// Calibration stats over RESOLVED predictions only.
    ///
    /// `deck_id` filters to a single deck via the `cards.deck_id` join; pass
    /// `None` for « every deck ». Buckets always have 10 entries — empty
    /// bands surface as `count = 0` so the UI can render a stable axis
    /// regardless of how much data is in.
    pub fn calibration_stats(&self, deck_id: Option<i64>) -> AppResult<CalibrationStats> {
        // P060 — the calibration dashboard used to SELECT every resolved
        // prediction (and every confidence_post review) into a Vec, then bucket
        // / average / sample in Rust. For a power-user with tens of thousands of
        // reviews that's a multi-megabyte allocation on a single Stats click,
        // with a `to_vec()` clone on top for the γ sub-sample. We now push the
        // O(N) work — bucketing, counts and means — into a single GROUP BY in
        // SQLite, and only pull a bounded random sample (≤ GAMMA_SAMPLE rows)
        // into memory for the O(K²) γ. Memory is now O(buckets + K), not O(N).

        // 1) Prospective: per-band aggregates straight from SQL.
        let bands = self.resolved_band_aggregates(deck_id)?;
        let (buckets, total_resolved, bias) = buckets_and_bias_from_bands(&bands);

        // 2) Prospective γ over a bounded random sample.
        let gamma = goodman_kruskal_gamma(&self.resolved_gamma_sample(deck_id)?);

        // 3) Retrospective calibration (Vague 22): confidence_post vs the same
        //    review's Good/Easy outcome. Independent of the JOL predictions —
        //    it answers "once you'd seen the answer, did your confidence track
        //    reality?" rather than "could you predict it in advance?". Mean /
        //    count come from SQL; γ from a bounded random sample.
        let (total_post, retro_sum_conf, retro_sum_correct) =
            self.retrospective_aggregate(deck_id)?;
        let (gamma_post, bias_post) = if total_post >= RETRO_MIN_SAMPLE {
            let mean_p = retro_sum_conf / total_post as f64;
            let mean_a = retro_sum_correct as f64 / total_post as f64;
            let sample = self.retrospective_gamma_sample(deck_id)?;
            (Some(goodman_kruskal_gamma(&sample)), Some(mean_p - mean_a))
        } else {
            (None, None)
        };

        Ok(CalibrationStats {
            gamma,
            bias,
            buckets,
            total_resolved,
            gamma_post,
            bias_post,
            total_post,
        })
    }

    // ---- internals ---------------------------------------------------------

    /// P060 — per-band aggregates for the prospective calibration histogram,
    /// computed in SQLite (`GROUP BY` the 0.1-wide confidence band) so we never
    /// materialise one Rust row per resolved prediction. Returns at most 10
    /// rows: `(band_index, count, sum_predicted, sum_correct)`. `band_index` is
    /// `min(floor(predicted_prob * 10), 9)` so `1.0` falls into the last bucket
    /// — exactly the clamp the old Rust loop applied.
    fn resolved_band_aggregates(&self, deck_id: Option<i64>) -> AppResult<Vec<BandAgg>> {
        let map_row = |row: &Row<'_>| -> rusqlite::Result<BandAgg> {
            Ok(BandAgg {
                band_index: row.get::<_, i64>(0)?.clamp(0, 9) as usize,
                count: row.get(1)?,
                sum_predicted: row.get(2)?,
                sum_correct: row.get(3)?,
            })
        };
        let mut out = Vec::new();
        if let Some(deck_id) = deck_id {
            let mut stmt = self.conn.prepare(
                "SELECT MIN(CAST(j.predicted_prob * 10 AS INTEGER), 9) AS band,
                        COUNT(*), SUM(j.predicted_prob), SUM(j.actual_correct)
                 FROM jol_predictions j
                 INNER JOIN cards c ON c.id = j.card_id
                 WHERE j.actual_correct IS NOT NULL AND c.deck_id = ?1
                 GROUP BY band",
            )?;
            for r in stmt.query_map(params![deck_id], map_row)? {
                out.push(r?);
            }
        } else {
            let mut stmt = self.conn.prepare(
                "SELECT MIN(CAST(predicted_prob * 10 AS INTEGER), 9) AS band,
                        COUNT(*), SUM(predicted_prob), SUM(actual_correct)
                 FROM jol_predictions
                 WHERE actual_correct IS NOT NULL
                 GROUP BY band",
            )?;
            for r in stmt.query_map([], map_row)? {
                out.push(r?);
            }
        }
        Ok(out)
    }

    /// P060 — a bounded uniform random sample of resolved `(predicted, actual)`
    /// pairs for the O(K²) γ. `ORDER BY RANDOM() LIMIT GAMMA_SAMPLE` does the
    /// sampling in SQLite, so we pull at most `GAMMA_SAMPLE` rows into memory
    /// instead of the whole table plus a `to_vec()` clone. When the resolved
    /// set is already ≤ GAMMA_SAMPLE this returns every row (the sort is a
    /// no-op-sized heap), so the γ is exact for small histories.
    fn resolved_gamma_sample(&self, deck_id: Option<i64>) -> AppResult<Vec<(f64, bool)>> {
        let map_row = |row: &Row<'_>| -> rusqlite::Result<(f64, bool)> {
            let p: f64 = row.get(0)?;
            let a: i64 = row.get(1)?;
            Ok((p, a != 0))
        };
        let mut out = Vec::new();
        if let Some(deck_id) = deck_id {
            let mut stmt = self.conn.prepare(
                "SELECT j.predicted_prob, j.actual_correct
                 FROM jol_predictions j
                 INNER JOIN cards c ON c.id = j.card_id
                 WHERE j.actual_correct IS NOT NULL AND c.deck_id = ?1
                 ORDER BY RANDOM() LIMIT ?2",
            )?;
            for r in stmt.query_map(params![deck_id, GAMMA_SAMPLE], map_row)? {
                out.push(r?);
            }
        } else {
            let mut stmt = self.conn.prepare(
                "SELECT predicted_prob, actual_correct
                 FROM jol_predictions
                 WHERE actual_correct IS NOT NULL
                 ORDER BY RANDOM() LIMIT ?1",
            )?;
            for r in stmt.query_map(params![GAMMA_SAMPLE], map_row)? {
                out.push(r?);
            }
        }
        Ok(out)
    }

    /// P060 — retrospective sample size and running sums, computed in SQL so the
    /// dashboard never loads one Rust row per `confidence_post` review just to
    /// average. Returns `(count, sum_normalised_confidence, sum_correct)` where
    /// the normalised confidence is `(clamp(confidence_post, 1, 5) - 1) / 4` and
    /// `correct` is `rating >= 3` — identical to the old per-row mapping. Rows
    /// without a `confidence_post` are excluded by the partial index predicate.
    fn retrospective_aggregate(&self, deck_id: Option<i64>) -> AppResult<(i64, f64, i64)> {
        // SUM(...) is NULL over an empty set, so columns 1 and 2 are read as
        // Option and coalesced below; COUNT(*) is never NULL.
        let map_row = |row: &Row<'_>| -> rusqlite::Result<(i64, Option<f64>, Option<i64>)> {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        };
        // `(MIN(MAX(c,1),5) - 1) / 4.0` clamps confidence_post into [1,5] then
        // normalises to [0,1] exactly as the Rust `c.clamp(1, 5)` did. The
        // `* 1.0` forces REAL division. SUM over an empty set is NULL, so the
        // sums are read as Option and coalesced to 0.
        let (count, sum_conf, sum_correct): (i64, Option<f64>, Option<i64>) =
            if let Some(deck_id) = deck_id {
                self.conn.query_row(
                    "SELECT COUNT(*),
                            SUM((MIN(MAX(r.confidence_post, 1), 5) - 1) / 4.0),
                            SUM(CASE WHEN r.rating >= 3 THEN 1 ELSE 0 END)
                     FROM reviews r
                     INNER JOIN cards c ON c.id = r.card_id
                     WHERE r.confidence_post IS NOT NULL AND c.deck_id = ?1",
                    params![deck_id],
                    map_row,
                )?
            } else {
                self.conn.query_row(
                    "SELECT COUNT(*),
                            SUM((MIN(MAX(confidence_post, 1), 5) - 1) / 4.0),
                            SUM(CASE WHEN rating >= 3 THEN 1 ELSE 0 END)
                     FROM reviews
                     WHERE confidence_post IS NOT NULL",
                    [],
                    map_row,
                )?
            };
        Ok((count, sum_conf.unwrap_or(0.0), sum_correct.unwrap_or(0)))
    }

    /// P060 — bounded random sample of retrospective `(confidence, correct)`
    /// pairs for the retrospective γ (Vague 22). `confidence` is
    /// `reviews.confidence_post` normalised from 1-5 to `[0, 1]` via
    /// `(clamp(c,1,5) - 1) / 4`; `correct` is `rating >= 3` (Good/Easy). Caps at
    /// `GAMMA_SAMPLE` rows via `ORDER BY RANDOM() LIMIT`. Rows without a
    /// `confidence_post` are excluded.
    fn retrospective_gamma_sample(&self, deck_id: Option<i64>) -> AppResult<Vec<(f64, bool)>> {
        let map_row = |row: &Row<'_>| -> rusqlite::Result<(f64, bool)> {
            let c: i64 = row.get(0)?;
            let rating: i64 = row.get(1)?;
            // Clamp defensively: a stray out-of-range value can't push the
            // normalised confidence outside [0, 1].
            let norm = ((c.clamp(1, 5) - 1) as f64) / 4.0;
            Ok((norm, rating >= 3))
        };
        let mut out = Vec::new();
        if let Some(deck_id) = deck_id {
            let mut stmt = self.conn.prepare(
                "SELECT r.confidence_post, r.rating
                 FROM reviews r
                 INNER JOIN cards c ON c.id = r.card_id
                 WHERE r.confidence_post IS NOT NULL AND c.deck_id = ?1
                 ORDER BY RANDOM() LIMIT ?2",
            )?;
            for r in stmt.query_map(params![deck_id, GAMMA_SAMPLE], map_row)? {
                out.push(r?);
            }
        } else {
            let mut stmt = self.conn.prepare(
                "SELECT confidence_post, rating
                 FROM reviews
                 WHERE confidence_post IS NOT NULL
                 ORDER BY RANDOM() LIMIT ?1",
            )?;
            for r in stmt.query_map(params![GAMMA_SAMPLE], map_row)? {
                out.push(r?);
            }
        }
        Ok(out)
    }
}

/// P060 — one row of the SQL `GROUP BY band` aggregate: how many resolved
/// predictions landed in this 0.1-wide confidence band, plus the running sums
/// the dashboard needs (mean predicted, empirical recall).
struct BandAgg {
    band_index: usize,
    count: i64,
    sum_predicted: f64,
    sum_correct: i64,
}

/// P060 — fold the (≤ 10) SQL band aggregates into the always-10-entry bucket
/// histogram, the total resolved count, and the global bias = mean(predicted) -
/// mean(actual). Empty bands surface as `count = 0` so the UI axis stays
/// stable. Bias is `0.0` when there is no data, matching the old behaviour.
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

/// P060 — the maximum number of `(predicted, actual)` pairs pulled into memory
/// for a γ computation. The caller samples this many rows in SQL
/// (`ORDER BY RANDOM() LIMIT GAMMA_SAMPLE`), so the O(K²) pair scan below runs
/// against a bounded slice and a learner with tens of thousands of predictions
/// neither allocates a huge Vec nor stalls the stats dashboard.
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
/// SQL, see [`MetacognitionRepo::resolved_gamma_sample`]), so this operates
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

fn row_to_jol(row: &Row<'_>) -> rusqlite::Result<JolPrediction> {
    let actual: Option<i64> = row.get(5)?;
    Ok(JolPrediction {
        id: row.get(0)?,
        card_id: row.get(1)?,
        predicted_at: row.get(2)?,
        predicted_prob: row.get(3)?,
        prediction_horizon_days: row.get(4)?,
        actual_correct: actual.map(|v| v != 0),
        resolved_at: row.get(6)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::cards::CardState;
    use crate::db::notes::NoteTemplate;
    use crate::db::reviews::NewReview;
    use crate::db::Database;
    use serde_json::json;

    /// Insert one deck + note + card and return the card id, for review-backed
    /// retrospective-calibration tests.
    fn seed_card(db: &Database) -> i64 {
        let conn = db.lock();
        let deck = db
            .decks(&conn)
            .create("D", None, "#3b82f6", 0.9, None, None, None)
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
        conn.query_row(
            "SELECT id FROM cards WHERE note_id = ?1",
            params![note.id],
            |r| r.get(0),
        )
        .unwrap()
    }

    /// Append a review carrying a retrospective `confidence_post` (1-5) and a
    /// FSRS `rating` (1-4) to drive the retrospective calibration computation.
    fn add_review(db: &Database, card_id: i64, rating: i64, confidence_post: i64, at: i64) {
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
                    confidence: None,
                    confidence_post: Some(confidence_post),
                },
                at,
            )
            .unwrap();
    }

    #[test]
    fn calibration_includes_retrospective() {
        let db = Database::for_test();
        let card_id = seed_card(&db);

        // No post-confidence reviews yet -> retrospective fields stay None and
        // the sample count is zero (dashboard hides the second line).
        {
            let conn = db.lock();
            let empty = MetacognitionRepo::new(&conn)
                .calibration_stats(None)
                .unwrap();
            assert_eq!(empty.total_post, 0);
            assert!(empty.gamma_post.is_none());
            assert!(empty.bias_post.is_none());
        }

        // Add ≥ RETRO_MIN_SAMPLE reviews where HIGH post-confidence lines up
        // with Good/Easy (rating 3-4) and LOW post-confidence with Again/Hard
        // (rating 1-2): a strong positive retrospective γ.
        let mut t = 1_700_000_000;
        for _ in 0..6 {
            add_review(&db, card_id, 4, 5, t); // confident + correct
            t += 100;
            add_review(&db, card_id, 1, 1, t); // unsure + wrong
            t += 100;
        }

        let conn = db.lock();
        let stats = MetacognitionRepo::new(&conn)
            .calibration_stats(None)
            .unwrap();
        assert_eq!(stats.total_post, 12, "every review carries confidence_post");
        let gamma_post = stats.gamma_post.expect("retrospective γ should be present");
        assert!(
            gamma_post > 0.9,
            "expected strong positive retrospective γ, got {gamma_post}"
        );
        // Mean confidence (≈ (1.0 + 0.0)/2 = 0.5) ≈ mean correct (6/12 = 0.5),
        // so the retrospective bias is near zero.
        let bias_post = stats
            .bias_post
            .expect("retrospective bias should be present");
        assert!(
            bias_post.abs() < 0.1,
            "expected near-zero retrospective bias, got {bias_post}"
        );
        // The prospective fields are independent and untouched (no JOLs here).
        assert_eq!(stats.total_resolved, 0);
    }

    /// P058 — a delayed JOL must NOT be resolved by a review that happens
    /// before its prediction horizon has elapsed; only the first review at or
    /// after `predicted_at + horizon*86400` resolves it, and only that
    /// post-horizon outcome reaches the calibration stats.
    #[test]
    fn resolve_respects_prediction_horizon() {
        const DAY: i64 = 86_400;
        let db = Database::for_test();
        let card_id = seed_card(&db);
        let conn = db.lock();
        let meta = MetacognitionRepo::new(&conn);

        let predicted_at = 1_700_000_000;
        let horizon_days = 7;
        meta.record_prediction(card_id, 0.9, horizon_days, predicted_at)
            .expect("record");

        // A review 2 minutes later is INSIDE the horizon → no resolution. The
        // immediate outcome (here a failure) must not pollute the delayed JOL.
        let immediate = predicted_at + 120;
        assert_eq!(
            meta.resolve_prediction(card_id, false, immediate).unwrap(),
            0,
            "a pre-horizon review must not resolve a delayed JOL"
        );
        // Still pending, still unresolved → calibration sees nothing yet.
        assert_eq!(
            meta.calibration_stats(None).unwrap().total_resolved,
            0,
            "an unresolved prediction must not feed calibration"
        );

        // A review one second before the horizon end is still too early.
        let just_before = predicted_at + horizon_days * DAY - 1;
        assert_eq!(
            meta.resolve_prediction(card_id, false, just_before).unwrap(),
            0,
            "resolution must wait until predicted_at + horizon*86400"
        );

        // The first review AT/after the horizon resolves it, and that outcome
        // (correct) is the one calibration records.
        let after_horizon = predicted_at + horizon_days * DAY;
        assert_eq!(
            meta.resolve_prediction(card_id, true, after_horizon).unwrap(),
            1,
            "the first post-horizon review must resolve the JOL"
        );
        let stats = meta.calibration_stats(None).unwrap();
        assert_eq!(stats.total_resolved, 1);
        // Predicted 0.9, resolved correct → bias ≈ 0.9 - 1.0 = -0.1.
        assert!(
            (stats.bias - (0.9 - 1.0)).abs() < 1e-9,
            "calibration must use the post-horizon outcome, got bias {}",
            stats.bias
        );
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
