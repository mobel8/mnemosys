//! Metacognition Tauri command — CBM calibration (v0.11).
//!
//! Single call site: `get_calibration_stats` feeds the calibration dashboard
//! (γ, bias, 10 confidence buckets) from the prospective 1-5 confidence the
//! learner gives before the flip (`reviews.confidence`, written by
//! `submit_review` when the confidence toggle is on). No extra capture flow
//! is needed — every CBM-rated review is a calibration sample.
//!
//! v0.11 — the delayed-JOL commands (`record_jol`, `get_pending_jols`) were
//! removed together with the stillborn `jol_predictions` pipeline (the prompt
//! that recorded predictions only opened when predictions already existed,
//! so the table could never receive its first row).

use chrono::Utc;
use tauri::State;

use crate::app_state::AppState;
use crate::db::CalibrationStats;
use crate::error::AppResult;

/// `deck_id = None` aggregates every deck. `days` is the stats-page period
/// window (7/30/90/365); `None` (or an omitted argument) means all-time.
#[tauri::command]
pub fn get_calibration_stats(
    state: State<'_, AppState>,
    deck_id: Option<i64>,
    days: Option<u32>,
) -> AppResult<CalibrationStats> {
    let now = Utc::now().timestamp();
    let conn = state.db.lock();
    state
        .db
        .metacognition(&conn)
        .calibration_stats(deck_id, days, now)
}
