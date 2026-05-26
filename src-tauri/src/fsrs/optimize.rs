//! FSRS parameter optimization (Session 4).
//!
//! Replays the entire `reviews` log to feed `fsrs::FSRS::compute_parameters`,
//! producing a freshly-calibrated 21-element parameter vector tailored to the
//! user's actual memorisation behaviour.
//!
//! Pipeline
//! --------
//! 1. Pull every row from `reviews` ordered by `(card_id, reviewed_at)`.
//! 2. Group rows by `card_id`. For each card, build a single `FSRSItem` whose
//!    `reviews` field is the chronological list of `FSRSReview { rating, delta_t }`.
//!    The first review of each card uses `delta_t = 0` per FSRS contract;
//!    subsequent ones use `floor((reviewed_at[i] - reviewed_at[i-1]) / 86400)`.
//! 3. Hand the resulting `Vec<FSRSItem>` to `FSRS::default().compute_parameters(...)`
//!    with FSRS-6 defaults (`enable_short_term = true`, `num_relearning_steps = None`).
//!
//! Validation
//! ----------
//! Calibration is gated on **at least 1000 reviews** total — the threshold
//! documented by upstream FSRS as the point past which a custom fit out-performs
//! the global defaults. Below that, we return `AppError::Validation` rather
//! than silently producing low-quality parameters.
//!
//! The function is **read-only**: it never touches `ParamsRepo`. Persistence
//! is intentionally left to the commands layer so the UI can show a
//! before/after preview and demand explicit user confirmation.

use fsrs::{ComputeParametersInput, FSRSItem, FSRSReview, FSRS};

use crate::db::Database;
use crate::error::{AppError, AppResult};

/// Minimum review count below which optimisation is rejected. Mirrors the
/// guidance in the upstream FSRS-rs README: with fewer than ~1k reviews the
/// optimiser falls back to default-derived parameters anyway.
pub const MIN_REVIEWS_FOR_OPTIM: usize = 1000;

/// Build `FSRSItem`s from the persisted review log and run the FSRS
/// optimiser. Returns the freshly-computed 21-element parameter vector.
///
/// Errors with `AppError::Validation` when the user has fewer than
/// [`MIN_REVIEWS_FOR_OPTIM`] reviews. Bubbles `AppError::Database` for any
/// SQLite hiccup and `AppError::Fsrs` if the upstream training routine
/// refuses to converge.
pub fn optimize_params_from_history(db: &Database) -> AppResult<Vec<f32>> {
    let rows = collect_reviews(db)?;
    if rows.len() < MIN_REVIEWS_FOR_OPTIM {
        return Err(AppError::Validation(format!(
            "Insufficient review history. At least {} reviews recommended (currently {}).",
            MIN_REVIEWS_FOR_OPTIM,
            rows.len()
        )));
    }

    let items = rows_to_fsrs_items(rows);
    // `FSRS::new(None)` builds a default-parameter scheduler — the underlying
    // weights are irrelevant for `compute_parameters`, which only uses the
    // tensor backend / device from `self`. There is no `FSRS::default()` in
    // the upstream crate.
    let fsrs = FSRS::new(None).map_err(|e| AppError::Fsrs(e.to_string()))?;
    let input = ComputeParametersInput {
        train_set: items,
        progress: None,
        enable_short_term: true,
        num_relearning_steps: None,
    };
    let params = fsrs
        .compute_parameters(input)
        .map_err(|e| AppError::Fsrs(format!("compute_parameters: {}", e)))?;
    Ok(params)
}

/// One row of the `reviews` table, narrowed to the three columns we need
/// to rebuild an `FSRSItem`. Kept private to this module.
#[derive(Debug, Clone, Copy)]
struct ReviewRow {
    card_id: i64,
    reviewed_at: i64,
    rating: u32,
}

/// Pull the relevant columns from the `reviews` table sorted by
/// `(card_id, reviewed_at)` — that ordering is required by the grouping
/// step in [`rows_to_fsrs_items`].
fn collect_reviews(db: &Database) -> AppResult<Vec<ReviewRow>> {
    let conn = db.lock();
    let mut stmt = conn.prepare(
        "SELECT card_id, reviewed_at, rating
         FROM reviews
         ORDER BY card_id ASC, reviewed_at ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        let card_id: i64 = row.get(0)?;
        let reviewed_at: i64 = row.get(1)?;
        let rating: i64 = row.get(2)?;
        Ok(ReviewRow {
            card_id,
            reviewed_at,
            // Ratings are persisted as 1..=4 (constrained by the schema).
            rating: rating as u32,
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

/// Group consecutive rows by `card_id` and build one `FSRSItem` per card.
/// Within each card group:
///   - the first review uses `delta_t = 0` (FSRS convention for the seed review)
///   - subsequent reviews use `delta_t = floor((curr - prev) / 86_400)` clamped to 0
///
/// Cards with a single review still produce a one-element `FSRSItem`; the
/// upstream `prepare_training_data` filter handles edge cases internally.
fn rows_to_fsrs_items(rows: Vec<ReviewRow>) -> Vec<FSRSItem> {
    if rows.is_empty() {
        return Vec::new();
    }
    let mut items: Vec<FSRSItem> = Vec::new();
    let mut current_card_id: i64 = rows[0].card_id;
    let mut current_reviews: Vec<FSRSReview> = Vec::new();
    let mut prev_at: i64 = rows[0].reviewed_at;

    for (idx, row) in rows.iter().enumerate() {
        if idx == 0 || row.card_id != current_card_id {
            // Flush the previous group (skip the very first iteration since
            // current_reviews is still empty).
            if !current_reviews.is_empty() {
                items.push(FSRSItem {
                    reviews: std::mem::take(&mut current_reviews),
                });
            }
            current_card_id = row.card_id;
            // First review of a brand-new card group: delta_t = 0.
            current_reviews.push(FSRSReview {
                rating: row.rating,
                delta_t: 0,
            });
            prev_at = row.reviewed_at;
            continue;
        }

        let delta_secs = (row.reviewed_at - prev_at).max(0);
        let delta_t = (delta_secs / 86_400) as u32;
        current_reviews.push(FSRSReview {
            rating: row.rating,
            delta_t,
        });
        prev_at = row.reviewed_at;
    }
    if !current_reviews.is_empty() {
        items.push(FSRSItem {
            reviews: current_reviews,
        });
    }
    items
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::reviews::NewReview;
    use crate::db::CardState;
    use chrono::Utc;
    use rusqlite::params;

    /// Build a fresh in-memory DB with one deck, `cards_count` cards, and
    /// `reviews_per_card` synthetic reviews each. The synthetic data is
    /// deliberately simple — alternating Good/Easy ratings on a daily
    /// cadence — so the optimiser sees a coherent (if boring) history.
    ///
    /// Everything is inserted under a single lock to keep the test fast.
    fn seed_review_history(db: &Database, cards_count: usize, reviews_per_card: usize) {
        let conn = db.lock();
        let now = Utc::now().timestamp();
        conn.execute(
            "INSERT INTO decks (name, description, color, desired_retention, created_at, updated_at)
             VALUES ('optim-test', NULL, '#000', 0.9, ?1, ?1)",
            params![now],
        )
        .unwrap();
        let deck_id = conn.last_insert_rowid();

        let reviews_repo = crate::db::reviews::ReviewRepo::new(&conn);
        for n in 0..cards_count {
            // 1 note + 1 card per note. We don't go through NoteRepo to keep
            // the fixture fast and self-contained.
            conn.execute(
                "INSERT INTO notes (deck_id, template, fields, tags, created_at, updated_at)
                 VALUES (?1, 'basic', '{}', '[]', ?2, ?2)",
                params![deck_id, now],
            )
            .unwrap();
            let note_id = conn.last_insert_rowid();
            conn.execute(
                "INSERT INTO cards (note_id, deck_id, card_ord, state, created_at, updated_at)
                 VALUES (?1, ?2, 0, 'review', ?3, ?3)",
                params![note_id, deck_id, now],
            )
            .unwrap();
            let card_id = conn.last_insert_rowid();

            // First review: state_before = 'new'. Subsequent: 'review'.
            for i in 0..reviews_per_card {
                let rating = if i % 2 == 0 { 3 } else { 4 };
                let state_before = if i == 0 {
                    CardState::New
                } else {
                    CardState::Review
                };
                // Stagger cards by 7 seconds so per-card timestamps stay
                // monotonically increasing within a card group.
                let reviewed_at = now + (n as i64) * 7 + (i as i64) * 86_400;
                reviews_repo
                    .insert(
                        NewReview {
                            card_id,
                            rating,
                            state_before,
                            state_after: CardState::Review,
                            stability_before: if i == 0 { None } else { Some(1.0) },
                            stability_after: 2.0,
                            difficulty_before: if i == 0 { None } else { Some(5.0) },
                            difficulty_after: 5.0,
                            elapsed_days: if i == 0 { 0 } else { 1 },
                            scheduled_days: 2,
                            review_time: 3_000,
                            confidence: None,
                        },
                        reviewed_at,
                    )
                    .unwrap();
            }
        }
    }

    #[test]
    fn rejects_when_fewer_than_threshold() {
        let db = Database::for_test();
        // 5 cards × 10 reviews = 50 reviews — well below MIN_REVIEWS_FOR_OPTIM.
        seed_review_history(&db, 5, 10);
        let err = optimize_params_from_history(&db).unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("Insufficient"), "got: {}", msg);
        assert!(msg.contains("1000"), "should mention threshold, got: {}", msg);
    }

    #[test]
    fn rejects_empty_history() {
        let db = Database::for_test();
        let err = optimize_params_from_history(&db).unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
    }

    #[test]
    fn rows_to_fsrs_items_groups_by_card() {
        let rows = vec![
            ReviewRow {
                card_id: 1,
                reviewed_at: 0,
                rating: 3,
            },
            ReviewRow {
                card_id: 1,
                reviewed_at: 86_400,
                rating: 4,
            },
            ReviewRow {
                card_id: 2,
                reviewed_at: 0,
                rating: 1,
            },
        ];
        let items = rows_to_fsrs_items(rows);
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].reviews.len(), 2);
        assert_eq!(items[0].reviews[0].delta_t, 0);
        assert_eq!(items[0].reviews[1].delta_t, 1);
        assert_eq!(items[1].reviews.len(), 1);
        assert_eq!(items[1].reviews[0].rating, 1);
    }

    #[test]
    fn rows_to_fsrs_items_handles_empty() {
        assert!(rows_to_fsrs_items(Vec::new()).is_empty());
    }

    /// Slow-ish test: 100 cards × 10 reviews = 1000 reviews — the minimum
    /// threshold. The FSRS training pass is fast on a synthetic dataset of
    /// this size (well under a second on a modern CPU) but we still tag
    /// the test with a comment so future maintainers know the cost.
    #[test]
    fn returns_21_params_for_sufficient_history() {
        let db = Database::for_test();
        seed_review_history(&db, 100, 10);
        let params = optimize_params_from_history(&db).expect("optimizer should succeed");
        assert_eq!(params.len(), 21, "FSRS-6 expects 21 parameters");
        // Sanity: every value must be finite (no NaN/Inf leaking out).
        for (i, p) in params.iter().enumerate() {
            assert!(p.is_finite(), "param[{}] = {} is not finite", i, p);
        }
    }
}
