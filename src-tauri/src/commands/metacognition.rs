//! Metacognition Tauri commands (Vague 7 — delayed JOLs).
//!
//! Three call sites:
//!   1. `record_jol`        — the learner submits a prediction (often via
//!      the delayed-JOL prompt 30+ min after the original review).
//!   2. `get_pending_jols`  — feeds the delayed-JOL prompt: which cards
//!      need a delayed prediction now? Pairs each `JolPrediction` with
//!      the `CardWithNote` so the UI can render the question + recto
//!      without a second round-trip.
//!   3. `get_calibration_stats` — feeds the calibration dashboard
//!      (γ, bias, 10 confidence buckets).
//!
//! Resolution (mapping a prediction to an outcome) is hooked into
//! `submit_review` directly so the calibration data updates as the learner
//! continues normal review.

use chrono::Utc;
use serde::Serialize;
use tauri::State;

use crate::app_state::AppState;
use crate::db::{CalibrationStats, CardWithNote, JolPrediction};
use crate::error::{AppError, AppResult};

/// One unresolved JOL paired with the card it was given for. Returned by
/// [`get_pending_jols`] so the UI can render the recto + a confidence
/// slider without a second IPC call.
#[derive(Debug, Clone, Serialize)]
pub struct PendingJolDTO {
    pub prediction: JolPrediction,
    pub card: CardWithNote,
}

#[tauri::command]
pub fn record_jol(
    state: State<'_, AppState>,
    card_id: i64,
    predicted_prob: f64,
    horizon_days: Option<i64>,
) -> AppResult<JolPrediction> {
    if !(0.0..=1.0).contains(&predicted_prob) {
        return Err(AppError::Validation(format!(
            "predicted_prob must be in [0.0, 1.0] (got {})",
            predicted_prob
        )));
    }
    let now = Utc::now().timestamp();
    let conn = state.db.lock();
    state.db.metacognition(&conn).record_prediction(
        card_id,
        predicted_prob,
        horizon_days.unwrap_or(7),
        now,
    )
}

#[tauri::command]
pub fn get_pending_jols(
    state: State<'_, AppState>,
    min_age_minutes: u32,
    limit: u32,
) -> AppResult<Vec<PendingJolDTO>> {
    let now = Utc::now().timestamp();
    let conn = state.db.lock();

    let pending =
        state
            .db
            .metacognition(&conn)
            .pending_predictions(min_age_minutes, limit.min(20), now)?;

    let mut out = Vec::with_capacity(pending.len());
    for prediction in pending {
        // `cards::get_with_note` not in repo — fall back to a hand-rolled
        // join. Two cheap selects keep this readable without bloating the
        // CardRepo surface.
        let card = state.db.cards(&conn).get(prediction.card_id)?;
        let note = state.db.notes(&conn).get(card.note_id)?;
        out.push(PendingJolDTO {
            prediction,
            card: CardWithNote { card, note },
        });
    }
    Ok(out)
}

#[tauri::command]
pub fn get_calibration_stats(
    state: State<'_, AppState>,
    deck_id: Option<i64>,
) -> AppResult<CalibrationStats> {
    let conn = state.db.lock();
    state.db.metacognition(&conn).calibration_stats(deck_id)
}
