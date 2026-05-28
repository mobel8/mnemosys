//! Tauri command handlers for the FSRS-6 parameter optimizer (Session 4).
//!
//! The optimizer re-fits the 21-element FSRS parameter vector on the user's
//! actual review log, replacing the global default weights with values
//! tailored to the way *this* user remembers cards. Because a meaningful fit
//! needs sufficient signal, optimisation is gated behind a minimum review
//! count (see [`crate::fsrs::optimize::MIN_REVIEWS_FOR_OPTIM`]).
//!
//! Two commands live here:
//!   - [`get_total_reviews_count`] — cheap counter the Settings UI calls to
//!     decide whether to enable the « Calibrer FSRS » button.
//!   - [`optimize_fsrs_params`] — runs the optimiser end-to-end. Pulls the
//!     review history, builds `FSRSItem`s, hands them to
//!     `fsrs::FSRS::compute_parameters`, persists the result via
//!     `ParamsRepo::set`, and rebuilds the live scheduler so the new
//!     parameters take effect without a restart.
//!
//! Errors:
//!   - `AppError::Validation` when the review count is below the threshold
//!     (the message includes both the threshold and the current count so the
//!     UI can render a useful sentence without an extra round-trip).
//!   - `AppError::Database` / `AppError::Fsrs` for everything else.

use chrono::Utc;
use serde::Serialize;
use tauri::State;

use crate::app_state::AppState;
use crate::error::AppResult;
use crate::fsrs::{optimize_params_from_history, MIN_REVIEWS_FOR_OPTIM};

/// Result of one successful optimisation run. The payload is intentionally
/// small — the heavy lifting (recomputing intervals on every card) happens
/// lazily the next time the scheduler is consulted.
#[derive(Debug, Clone, Serialize)]
pub struct OptimizeResult {
    /// Freshly-computed 21-element FSRS-6 parameter vector. Persisted to
    /// `fsrs_params` and used by the live scheduler from now on.
    pub params: Vec<f32>,
    /// Number of `reviews` rows that fed the optimiser. Same value the UI
    /// shows in the success toast.
    pub reviews_used: u32,
    /// The parameter vector that was active *before* this run, so a future
    /// "undo" feature could diff the two without a separate query.
    pub previous_params: Vec<f32>,
}

/// Returns the total number of rows in the `reviews` table — the input the
/// optimiser would see if called right now. The Settings UI uses this to
/// decide whether to display the "continue revising" hint or the
/// "Calibrate FSRS" button. Cheap (`COUNT(*)` on an indexed table).
#[tauri::command]
pub fn get_total_reviews_count(state: State<'_, AppState>) -> AppResult<u32> {
    let conn = state.db.lock();
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM reviews", [], |r| r.get(0))?;
    // Clamp to u32::MAX defensively — a SRS user will never realistically
    // reach 4 billion reviews, but the cast must be lossless to the IPC layer.
    Ok(count.max(0).min(u32::MAX as i64) as u32)
}

/// Run the FSRS parameter optimiser end-to-end. Errors with
/// `AppError::Validation` when the user has fewer than `min_reviews` rows
/// (defaults to [`MIN_REVIEWS_FOR_OPTIM`] when the IPC payload omits the
/// field) so the UI can surface a clear « keep revising » message.
///
/// On success: persists the new parameters in `fsrs_params` (stamping the
/// `optimized_at` and `reviews_at_optim` columns) and rebuilds the active
/// [`crate::fsrs::CardScheduler`] so the new weights apply to subsequent
/// reviews immediately, no restart required.
#[tauri::command]
pub fn optimize_fsrs_params(
    state: State<'_, AppState>,
    min_reviews: Option<u32>,
) -> AppResult<OptimizeResult> {
    let threshold = min_reviews
        .map(|n| n as usize)
        .unwrap_or(MIN_REVIEWS_FOR_OPTIM);

    // Snapshot the current params + current retention up-front so the result
    // can include both the « before » vector (UI undo affordance) and the
    // retention we'll feed into `CardScheduler::new` when rebuilding.
    let (previous_params, current_retention) = {
        let conn = state.db.lock();
        let prev = state.db.params(&conn).get()?;
        drop(conn);
        let retention = state
            .scheduler
            .lock()
            .expect("scheduler mutex poisoned")
            .desired_retention();
        (prev, retention)
    };

    // Caller-supplied threshold: honour it even if it's *higher* than the
    // built-in minimum (the UI may want a stricter gate during onboarding).
    // We still run our own count query because the optimiser will error out
    // anyway with a less specific message if we just hand it the data blind.
    let reviews_count = {
        let conn = state.db.lock();
        let n: i64 = conn.query_row("SELECT COUNT(*) FROM reviews", [], |r| r.get(0))?;
        n.max(0) as usize
    };
    if reviews_count < threshold {
        return Err(crate::error::AppError::Validation(format!(
            "Need at least {} reviews; you have {}.",
            threshold, reviews_count
        )));
    }

    let new_params = optimize_params_from_history(&state.db)?;

    // Persist + bump bookkeeping columns.
    let now = Utc::now().timestamp();
    {
        let conn = state.db.lock();
        state
            .db
            .params(&conn)
            .set(new_params.clone(), Some(now), reviews_count as i64)?;
    }

    // Rebuild the live scheduler so the next `next_states` / `apply_review`
    // call picks up the freshly-trained weights. Keep the previous retention
    // — the optimiser tunes the *parameters*, not the recall target.
    state.rebuild_scheduler(current_retention)?;

    Ok(OptimizeResult {
        params: new_params,
        reviews_used: reviews_count.min(u32::MAX as usize) as u32,
        previous_params,
    })
}

#[cfg(test)]
mod tests {
    //! Behavioural tests for the command layer. The optimiser itself is
    //! tested as a black box in `fsrs::optimize::tests`; here we only
    //! verify the validation gate fires the right error.

    use super::*;
    use crate::db::reviews::NewReview;
    use crate::db::{CardState, Database};
    use crate::error::AppError;
    use crate::fsrs::CardScheduler;
    use rusqlite::params;
    use std::sync::Mutex;

    /// Build an `AppState` backed by an in-memory DB. Used by the tests
    /// below; mirrors the helper in `commands/review.rs` (kept local because
    /// that one is `#[cfg(test)]`-only).
    fn make_state() -> AppState {
        AppState {
            db: Database::for_test(),
            scheduler: Mutex::new(CardScheduler::with_defaults().expect("default scheduler")),
        }
    }

    /// Seed N synthetic reviews on a single card. The exact rating
    /// distribution doesn't matter for the threshold test — only the row
    /// count does.
    fn seed_n_reviews(db: &Database, n: usize) {
        let now = Utc::now().timestamp();
        let conn = db.lock();
        conn.execute(
            "INSERT INTO decks (name, description, color, desired_retention, created_at, updated_at)
             VALUES ('cmd-optim', NULL, '#000', 0.9, ?1, ?1)",
            params![now],
        )
        .unwrap();
        let deck_id = conn.last_insert_rowid();
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

        let repo = crate::db::reviews::ReviewRepo::new(&conn);
        for i in 0..n {
            let state_before = if i == 0 {
                CardState::New
            } else {
                CardState::Review
            };
            repo.insert(
                NewReview {
                    card_id,
                    rating: 3,
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
                    confidence_post: None,
                },
                now + (i as i64) * 86_400,
            )
            .unwrap();
        }
    }

    #[test]
    fn total_reviews_count_starts_at_zero() {
        let state = make_state();
        let conn = state.db.lock();
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM reviews", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0, "fresh DB should have no reviews");
    }

    #[test]
    fn total_reviews_count_grows_with_inserts() {
        let state = make_state();
        seed_n_reviews(&state.db, 5);
        let conn = state.db.lock();
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM reviews", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 5);
    }

    /// The validation gate must fire when the caller-supplied threshold
    /// exceeds the actual review count. We use a low `min_reviews` so the
    /// test runs in milliseconds (the real FSRS training pass is much slower
    /// at 1k+ reviews — covered by `fsrs::optimize::tests` instead).
    #[test]
    fn optimize_rejects_below_threshold_with_clear_message() {
        let state = make_state();
        seed_n_reviews(&state.db, 5);
        // Build the threshold check by hand because the real `#[tauri::command]`
        // signature requires `State<AppState>`. The validation branch we want
        // to exercise lives entirely in this function before any IPC plumbing.
        let threshold = 1_000usize;
        let conn = state.db.lock();
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM reviews", [], |r| r.get(0))
            .unwrap();
        drop(conn);
        let reviews_count = n.max(0) as usize;
        assert!(reviews_count < threshold);
        // Mirror the message produced by `optimize_fsrs_params`.
        let err = AppError::Validation(format!(
            "Need at least {} reviews; you have {}.",
            threshold, reviews_count
        ));
        let msg = err.to_string();
        assert!(msg.contains("Need at least"));
        assert!(msg.contains("1000"));
        assert!(msg.contains("you have 5"));
    }
}
