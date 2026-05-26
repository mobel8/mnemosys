//! Analytics commands powering the Stats dashboard.
//!
//! Lightweight aggregates only; heavier per-deck / per-tag breakdowns will
//! land in Vague C once we know what the UI actually needs to render.

use serde::Serialize;
use tauri::State;

use crate::app_state::AppState;
use crate::db::{DayCount, DayRetention};
use crate::error::AppResult;

/// Aggregated counts shown on the Home page.
#[derive(Debug, Clone, Serialize)]
pub struct TodayStatsDTO {
    /// Reviews completed since midnight UTC.
    pub reviews_done_today: i64,
    /// Cards currently due (across every deck, suspended excluded).
    pub due_now: i64,
    /// New cards that have graduated to "learning" since midnight UTC.
    pub new_cards_today: i64,
    /// Fraction in `[0, 1]`; `0.0` when no reviews happened today.
    pub retention_today: f64,
}

#[tauri::command]
pub fn get_today_stats(state: State<'_, AppState>) -> AppResult<TodayStatsDTO> {
    let now_ts = chrono::Utc::now().timestamp();
    let start_of_day = start_of_utc_day(now_ts);

    let conn = state.db.lock();

    let reviews_done_today: i64 = conn.query_row(
        "SELECT COUNT(*) FROM reviews WHERE reviewed_at >= ?1",
        rusqlite::params![start_of_day],
        |r| r.get(0),
    )?;

    let due_now = state.db.cards(&conn).due_cards_count(None, now_ts)?;

    let new_cards_today: i64 = conn.query_row(
        "SELECT COUNT(*) FROM reviews
         WHERE reviewed_at >= ?1 AND state_before = 'new'",
        rusqlite::params![start_of_day],
        |r| r.get(0),
    )?;

    let retention_today: f64 = if reviews_done_today > 0 {
        let correct: i64 = conn.query_row(
            "SELECT COUNT(*) FROM reviews
             WHERE reviewed_at >= ?1 AND rating >= 3",
            rusqlite::params![start_of_day],
            |r| r.get(0),
        )?;
        correct as f64 / reviews_done_today as f64
    } else {
        0.0
    };

    Ok(TodayStatsDTO {
        reviews_done_today,
        due_now,
        new_cards_today,
        retention_today,
    })
}

#[tauri::command]
pub fn get_reviews_by_day(
    state: State<'_, AppState>,
    days: u32,
) -> AppResult<Vec<DayCount>> {
    let now = chrono::Utc::now().timestamp();
    let conn = state.db.lock();
    state.db.reviews(&conn).reviews_by_day(days, now)
}

#[tauri::command]
pub fn get_retention_by_day(
    state: State<'_, AppState>,
    days: u32,
) -> AppResult<Vec<DayRetention>> {
    let now = chrono::Utc::now().timestamp();
    let conn = state.db.lock();
    state.db.reviews(&conn).retention_by_day(days, now)
}

/// Floor a unix timestamp (seconds) to the start of its UTC day.
fn start_of_utc_day(ts: i64) -> i64 {
    ts - (ts.rem_euclid(86_400))
}
