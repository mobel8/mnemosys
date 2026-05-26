//! Wellness Tauri commands (Vague 3 — Neuro modes, opt-in).
//!
//! These are thin pass-through wrappers around [`WellnessRepo`]. The
//! frontend resolves "today" via JS so it can match the calendar shown
//! to the learner (browser locale TZ); the backend just stores whatever
//! ISO date string it receives.

use chrono::Utc;
use tauri::State;

use crate::app_state::AppState;
use crate::db::WellnessLog;
use crate::error::{AppError, AppResult};

/// Submit a fresh wellness check-in. Every value field is optional so a
/// learner who only filled « mood » can still persist. Validation is
/// deliberately lax: 0 ≤ sleep_hours ≤ 24, 1 ≤ mood/stress ≤ 5, so the
/// repo never has to guard against junk written by a misbehaving UI.
#[tauri::command]
pub fn submit_wellness_log(
    state: State<'_, AppState>,
    mood: Option<i64>,
    sleep_hours: Option<f64>,
    stress_level: Option<i64>,
    hydrated: bool,
    caffeine_taken: bool,
) -> AppResult<WellnessLog> {
    if let Some(m) = mood {
        if !(1..=5).contains(&m) {
            return Err(AppError::Validation(format!("mood out of range: {}", m)));
        }
    }
    if let Some(s) = stress_level {
        if !(1..=5).contains(&s) {
            return Err(AppError::Validation(format!(
                "stress_level out of range: {}",
                s
            )));
        }
    }
    if let Some(h) = sleep_hours {
        if !(0.0..=24.0).contains(&h) {
            return Err(AppError::Validation(format!(
                "sleep_hours out of range: {}",
                h
            )));
        }
    }
    let now = Utc::now();
    let date = now.format("%Y-%m-%d").to_string();
    let created_at = now.timestamp();
    let conn = state.db.lock();
    state.db.wellness(&conn).insert_log(
        &date,
        mood,
        sleep_hours,
        stress_level,
        hydrated,
        caffeine_taken,
        created_at,
    )
}

/// Returns today's wellness log if one exists. The frontend uses this to
/// decide whether to show the check-in modal at session start (skipping
/// it when the user already answered today).
#[tauri::command]
pub fn get_today_wellness(state: State<'_, AppState>) -> AppResult<Option<WellnessLog>> {
    let today = Utc::now().format("%Y-%m-%d").to_string();
    let conn = state.db.lock();
    state.db.wellness(&conn).log_for_date(&today)
}

/// Last `days` wellness logs (newest first). Used by future stats UI.
#[tauri::command]
pub fn get_recent_wellness(
    state: State<'_, AppState>,
    days: i64,
) -> AppResult<Vec<WellnessLog>> {
    let conn = state.db.lock();
    state.db.wellness(&conn).recent_logs(days)
}
