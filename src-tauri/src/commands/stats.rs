//! Analytics commands powering the Stats dashboard.
//!
//! Lightweight aggregates only; heavier per-deck / per-tag breakdowns will
//! land in Vague C once we know what the UI actually needs to render.

use chrono::{Local, TimeZone};
use serde::Serialize;
use tauri::State;

use crate::app_state::AppState;
use crate::db::{DayCount, DayRetention};
use crate::error::AppResult;

/// Aggregated counts shown on the Home page.
#[derive(Debug, Clone, Serialize)]
pub struct TodayStatsDTO {
    /// Reviews completed since local midnight.
    pub reviews_done_today: i64,
    /// Cards currently due (across every deck, suspended excluded).
    pub due_now: i64,
    /// New cards that have graduated to "learning" since local midnight.
    pub new_cards_today: i64,
    /// Fraction in `[0, 1]`; `0.0` when no reviews happened today.
    pub retention_today: f64,
}

#[tauri::command]
pub fn get_today_stats(state: State<'_, AppState>) -> AppResult<TodayStatsDTO> {
    let now_ts = chrono::Utc::now().timestamp();
    let start_of_day = start_of_local_day(now_ts);

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
pub fn get_reviews_by_day(state: State<'_, AppState>, days: u32) -> AppResult<Vec<DayCount>> {
    let now = chrono::Utc::now().timestamp();
    let conn = state.db.lock();
    state.db.reviews(&conn).reviews_by_day(days, now)
}

#[tauri::command]
pub fn get_retention_by_day(state: State<'_, AppState>, days: u32) -> AppResult<Vec<DayRetention>> {
    let now = chrono::Utc::now().timestamp();
    let conn = state.db.lock();
    state.db.reviews(&conn).retention_by_day(days, now)
}

/// Floor a unix timestamp (seconds) to the start of its LOCAL day.
///
/// "Today" must follow the user's wall clock: a review logged at 00:30 in
/// Paris belongs to the new local day even though UTC is still on the
/// previous one. Falls back to the plain UTC floor in the (practically
/// unreachable) cases where the timestamp or local midnight can't be
/// resolved — e.g. a DST jump that skips 00:00 — rather than erroring out
/// of a stats query.
fn start_of_local_day(ts: i64) -> i64 {
    let utc_floor = ts - ts.rem_euclid(86_400);
    let Some(dt) = Local.timestamp_opt(ts, 0).single() else {
        return utc_floor;
    };
    let midnight = dt
        .date_naive()
        .and_hms_opt(0, 0, 0)
        .expect("00:00:00 is a valid time");
    Local
        .from_local_datetime(&midnight)
        .earliest()
        .map(|local_midnight| local_midnight.timestamp())
        .unwrap_or(utc_floor)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The floored instant must be midnight on the same LOCAL calendar day as
    /// the input — the exact property the Home page "today" counters rely on.
    /// Computed via chrono `Local` on both sides so the test is correct in
    /// every timezone the suite runs in.
    #[test]
    fn start_of_local_day_is_local_midnight_of_same_day() {
        // Far from any midnight: local "now" keeps the test robust.
        let now = Local::now();
        let floored = start_of_local_day(now.timestamp());
        let floored_dt = Local
            .timestamp_opt(floored, 0)
            .single()
            .expect("floored ts is valid");
        assert_eq!(
            floored_dt.date_naive(),
            now.date_naive(),
            "floor must stay on the same local day"
        );
        assert_eq!(
            floored_dt.format("%H:%M:%S").to_string(),
            "00:00:00",
            "floor must land exactly on local midnight"
        );
    }

    /// Regression for the original bug: a fixed instant at 00:30 LOCAL time
    /// must floor to the same local date (the old UTC floor pushed it to the
    /// previous day for any user east of Greenwich, e.g. France at UTC+1).
    #[test]
    fn start_of_local_day_just_after_midnight_stays_on_todays_date() {
        let just_past_midnight = Local
            .with_ymd_and_hms(2024, 1, 15, 0, 30, 0)
            .earliest()
            .expect("2024-01-15 00:30 exists in every timezone");
        let floored = start_of_local_day(just_past_midnight.timestamp());
        let floored_dt = Local
            .timestamp_opt(floored, 0)
            .single()
            .expect("floored ts is valid");
        assert_eq!(
            floored_dt.date_naive().to_string(),
            "2024-01-15",
            "00:30 local must count toward Jan 15, not Jan 14"
        );
    }
}
