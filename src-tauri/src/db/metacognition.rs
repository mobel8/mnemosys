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
//!   - `actual_correct` stays NULL until the *next* review of the same
//!     card flips it to 0/1 (`resolve_prediction`).
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
    pub fn resolve_prediction(
        &self,
        card_id: i64,
        correct: bool,
        now: i64,
    ) -> AppResult<usize> {
        // SQLite has no « UPDATE … LIMIT 1 » without a subselect, so we do
        // the lookup explicitly. Cheap thanks to the partial index on
        // `actual_correct IS NULL`.
        let oldest_id: Option<i64> = self
            .conn
            .query_row(
                "SELECT id FROM jol_predictions
                 WHERE card_id = ?1 AND actual_correct IS NULL
                 ORDER BY predicted_at ASC
                 LIMIT 1",
                params![card_id],
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
        // 1) Load the (predicted, actual) pairs.
        let pairs = self.resolved_pairs(deck_id)?;
        let total_resolved = pairs.len() as i64;

        // 2) Bucket per 0.1 confidence band.
        let mut buckets: Vec<CalibrationBucket> = (0..10)
            .map(|i| CalibrationBucket {
                band: (i as f64) / 10.0,
                predicted: 0.0,
                actual: 0.0,
                count: 0,
            })
            .collect();
        for (p, a) in &pairs {
            let raw = (p * 10.0).floor() as isize;
            let idx = raw.clamp(0, 9) as usize;
            let b = &mut buckets[idx];
            b.predicted += *p;
            b.actual += if *a { 1.0 } else { 0.0 };
            b.count += 1;
        }
        for b in buckets.iter_mut() {
            if b.count > 0 {
                b.predicted /= b.count as f64;
                b.actual /= b.count as f64;
            }
        }

        // 3) Bias = mean(predicted) - mean(actual).
        let bias = if pairs.is_empty() {
            0.0
        } else {
            let mean_p: f64 = pairs.iter().map(|(p, _)| *p).sum::<f64>() / total_resolved as f64;
            let mean_a: f64 = pairs.iter().map(|(_, a)| if *a { 1.0 } else { 0.0 }).sum::<f64>()
                / total_resolved as f64;
            mean_p - mean_a
        };

        // 4) Goodman-Kruskal γ.
        let gamma = goodman_kruskal_gamma(&pairs);

        // 5) Retrospective calibration (Vague 22): confidence_post vs the same
        //    review's Good/Easy outcome. Independent of the JOL predictions —
        //    it answers "once you'd seen the answer, did your confidence track
        //    reality?" rather than "could you predict it in advance?".
        let retro = self.retrospective_pairs(deck_id)?;
        let total_post = retro.len() as i64;
        let (gamma_post, bias_post) = if total_post >= RETRO_MIN_SAMPLE {
            let mean_p: f64 = retro.iter().map(|(p, _)| *p).sum::<f64>() / total_post as f64;
            let mean_a: f64 = retro.iter().map(|(_, a)| if *a { 1.0 } else { 0.0 }).sum::<f64>()
                / total_post as f64;
            (
                Some(goodman_kruskal_gamma(&retro)),
                Some(mean_p - mean_a),
            )
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

    /// Fetch the resolved (predicted, actual) pairs. Optionally filtered by
    /// deck through the `cards` join.
    fn resolved_pairs(&self, deck_id: Option<i64>) -> AppResult<Vec<(f64, bool)>> {
        let mut out = Vec::new();
        if let Some(deck_id) = deck_id {
            let mut stmt = self.conn.prepare(
                "SELECT j.predicted_prob, j.actual_correct
                 FROM jol_predictions j
                 INNER JOIN cards c ON c.id = j.card_id
                 WHERE j.actual_correct IS NOT NULL AND c.deck_id = ?1",
            )?;
            let rows = stmt.query_map(params![deck_id], |row| {
                let p: f64 = row.get(0)?;
                let a: i64 = row.get(1)?;
                Ok((p, a != 0))
            })?;
            for r in rows {
                out.push(r?);
            }
        } else {
            let mut stmt = self.conn.prepare(
                "SELECT predicted_prob, actual_correct
                 FROM jol_predictions
                 WHERE actual_correct IS NOT NULL",
            )?;
            let rows = stmt.query_map([], |row| {
                let p: f64 = row.get(0)?;
                let a: i64 = row.get(1)?;
                Ok((p, a != 0))
            })?;
            for r in rows {
                out.push(r?);
            }
        }
        Ok(out)
    }

    /// Fetch retrospective `(confidence, correct)` pairs from `reviews`
    /// (Vague 22). `confidence` is `reviews.confidence_post` normalised from
    /// the 1-5 scale to `[0, 1]` via `(c - 1) / 4`; `correct` is `rating >= 3`
    /// (Good/Easy), matching the Good/Easy=correct mapping used when resolving
    /// JOL predictions. Rows without a `confidence_post` are excluded.
    /// Optionally filtered by deck through the `cards` join.
    fn retrospective_pairs(&self, deck_id: Option<i64>) -> AppResult<Vec<(f64, bool)>> {
        let mut out = Vec::new();
        let map_row = |row: &Row<'_>| -> rusqlite::Result<(f64, bool)> {
            let c: i64 = row.get(0)?;
            let rating: i64 = row.get(1)?;
            // Clamp defensively: a stray out-of-range value can't push the
            // normalised confidence outside [0, 1].
            let norm = ((c.clamp(1, 5) - 1) as f64) / 4.0;
            Ok((norm, rating >= 3))
        };
        if let Some(deck_id) = deck_id {
            let mut stmt = self.conn.prepare(
                "SELECT r.confidence_post, r.rating
                 FROM reviews r
                 INNER JOIN cards c ON c.id = r.card_id
                 WHERE r.confidence_post IS NOT NULL AND c.deck_id = ?1",
            )?;
            let rows = stmt.query_map(params![deck_id], map_row)?;
            for r in rows {
                out.push(r?);
            }
        } else {
            let mut stmt = self.conn.prepare(
                "SELECT confidence_post, rating
                 FROM reviews
                 WHERE confidence_post IS NOT NULL",
            )?;
            let rows = stmt.query_map([], map_row)?;
            for r in rows {
                out.push(r?);
            }
        }
        Ok(out)
    }
}

/// Goodman-Kruskal γ over `(predicted, actual)` pairs.
///
/// γ = (Nc - Nd) / (Nc + Nd)
///
/// where Nc = concordant pairs (predicted_i > predicted_j AND actual_i > actual_j),
///       Nd = discordant pairs (predicted_i > predicted_j AND actual_i < actual_j).
/// Ties on either dimension are ignored — the classical formula.
///
/// Returns `0.0` when there are no informative pairs. For large N
/// (`> SAMPLING_THRESHOLD`) we shuffle-sample to keep the call O(K²) with
/// a fixed K so a learner with thousands of predictions doesn't stall the
/// stats dashboard.
fn goodman_kruskal_gamma(pairs: &[(f64, bool)]) -> f64 {
    const SAMPLING_THRESHOLD: usize = 500;
    if pairs.len() < 2 {
        return 0.0;
    }

    let working: Vec<(f64, bool)> = if pairs.len() > SAMPLING_THRESHOLD {
        // Deterministic, dependency-free sampling: take a strided slice of
        // SAMPLING_THRESHOLD evenly-spaced indices. Good enough to estimate
        // γ on a uniform sub-sample; the alternative (full O(N²)) would
        // make this a noticeable hiccup on 5 k+ predictions.
        let step = pairs.len() / SAMPLING_THRESHOLD;
        let mut out = Vec::with_capacity(SAMPLING_THRESHOLD);
        let mut idx = 0;
        while idx < pairs.len() && out.len() < SAMPLING_THRESHOLD {
            out.push(pairs[idx]);
            idx += step.max(1);
        }
        out
    } else {
        pairs.to_vec()
    };

    let mut nc: i64 = 0;
    let mut nd: i64 = 0;
    for i in 0..working.len() {
        for j in (i + 1)..working.len() {
            let (pi, ai) = working[i];
            let (pj, aj) = working[j];
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
            let empty = MetacognitionRepo::new(&conn).calibration_stats(None).unwrap();
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
        let stats = MetacognitionRepo::new(&conn).calibration_stats(None).unwrap();
        assert_eq!(stats.total_post, 12, "every review carries confidence_post");
        let gamma_post = stats.gamma_post.expect("retrospective γ should be present");
        assert!(
            gamma_post > 0.9,
            "expected strong positive retrospective γ, got {gamma_post}"
        );
        // Mean confidence (≈ (1.0 + 0.0)/2 = 0.5) ≈ mean correct (6/12 = 0.5),
        // so the retrospective bias is near zero.
        let bias_post = stats.bias_post.expect("retrospective bias should be present");
        assert!(
            bias_post.abs() < 0.1,
            "expected near-zero retrospective bias, got {bias_post}"
        );
        // The prospective fields are independent and untouched (no JOLs here).
        assert_eq!(stats.total_resolved, 0);
    }

    #[test]
    fn gamma_returns_one_for_perfect_correlation() {
        // High predictions → correct, low predictions → incorrect.
        let pairs = vec![
            (0.9, true),
            (0.8, true),
            (0.2, false),
            (0.1, false),
        ];
        let g = goodman_kruskal_gamma(&pairs);
        assert!((g - 1.0).abs() < 1e-9, "expected γ ≈ 1.0, got {}", g);
    }

    #[test]
    fn gamma_returns_minus_one_for_inverse_correlation() {
        // High predictions → incorrect (the classic « confident-wrong »).
        let pairs = vec![
            (0.9, false),
            (0.8, false),
            (0.2, true),
            (0.1, true),
        ];
        let g = goodman_kruskal_gamma(&pairs);
        assert!((g + 1.0).abs() < 1e-9, "expected γ ≈ -1.0, got {}", g);
    }

    #[test]
    fn gamma_returns_zero_on_insufficient_data() {
        assert_eq!(goodman_kruskal_gamma(&[]), 0.0);
        assert_eq!(goodman_kruskal_gamma(&[(0.5, true)]), 0.0);
    }
}
