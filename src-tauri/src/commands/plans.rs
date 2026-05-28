//! Study-plan Tauri commands (Vague 21 — Implementation Intentions).
//!
//! Thin wrappers around [`PlanRepo`]. Validation is centralised here so the
//! repo never has to guard against junk: `trigger_type` is pinned to the three
//! accepted slugs, `time` triggers must look like `HH:MM`, and `days` must be
//! a JSON array of ISO weekday ints in `1..=7`. The frontend mirrors these
//! rules but the backend is the source of truth.

use chrono::Utc;
use tauri::State;

use crate::app_state::AppState;
use crate::db::StudyPlan;
use crate::error::{AppError, AppResult};

/// Accepted `trigger_type` values (must match the v16 CHECK constraint).
const TRIGGER_TYPES: [&str; 3] = ["time", "place", "after_habit"];

/// Validate the shared fields of a create/update payload. Returns the
/// canonical `days` JSON string (compacted) on success.
fn validate(
    trigger_type: &str,
    trigger_value: &str,
    action: &str,
    days: &str,
) -> AppResult<String> {
    if !TRIGGER_TYPES.contains(&trigger_type) {
        return Err(AppError::Validation(format!(
            "unknown trigger_type: {trigger_type}"
        )));
    }
    if trigger_value.trim().is_empty() {
        return Err(AppError::Validation("trigger_value is empty".into()));
    }
    if action.trim().is_empty() {
        return Err(AppError::Validation("action is empty".into()));
    }

    // `time` triggers must parse as HH:MM so the scheduler can compute a delay.
    if trigger_type == "time" {
        let ok = match trigger_value.split_once(':') {
            Some((h, m)) => matches!(
                (h.parse::<u32>(), m.parse::<u32>()),
                (Ok(h), Ok(m)) if h < 24 && m < 60
            ),
            None => false,
        };
        if !ok {
            return Err(AppError::Validation(format!(
                "time trigger must be HH:MM, got: {trigger_value}"
            )));
        }
    }

    // `days` must be a JSON array of ints in 1..=7. Re-serialise so we store a
    // canonical, compact form regardless of incoming whitespace.
    let parsed: Vec<i64> = serde_json::from_str(days)
        .map_err(|e| AppError::Validation(format!("days must be a JSON int array: {e}")))?;
    if parsed.iter().any(|d| !(1..=7).contains(d)) {
        return Err(AppError::Validation(
            "days entries must be ISO weekdays 1..=7".into(),
        ));
    }
    serde_json::to_string(&parsed).map_err(Into::into)
}

/// Every study plan, newest first.
#[tauri::command]
pub fn list_study_plans(state: State<'_, AppState>) -> AppResult<Vec<StudyPlan>> {
    let conn = state.db.lock();
    state.db.plans(&conn).list()
}

/// Create a study plan. `days` is a JSON array string (`"[1,3,5]"`, `"[]"` =
/// every day). `enabled` defaults to `true` when omitted by the caller.
#[tauri::command]
pub fn create_study_plan(
    state: State<'_, AppState>,
    trigger_type: String,
    trigger_value: String,
    action: String,
    deck_id: Option<i64>,
    days: String,
    enabled: Option<bool>,
) -> AppResult<StudyPlan> {
    let days = validate(&trigger_type, &trigger_value, &action, &days)?;
    let created_at = Utc::now().timestamp();
    let conn = state.db.lock();
    state.db.plans(&conn).create(
        &trigger_type,
        &trigger_value,
        &action,
        deck_id,
        &days,
        enabled.unwrap_or(true),
        created_at,
    )
}

/// Overwrite the mutable fields of an existing plan.
// One parameter per editable column; a struct would just relocate them and
// change the JS invoke shape. Mirrors the wellness/gamification command style.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn update_study_plan(
    state: State<'_, AppState>,
    id: i64,
    trigger_type: String,
    trigger_value: String,
    action: String,
    deck_id: Option<i64>,
    days: String,
    enabled: bool,
) -> AppResult<StudyPlan> {
    let days = validate(&trigger_type, &trigger_value, &action, &days)?;
    let conn = state.db.lock();
    state.db.plans(&conn).update(
        id,
        &trigger_type,
        &trigger_value,
        &action,
        deck_id,
        &days,
        enabled,
    )
}

/// Flip a plan's `enabled` flag.
#[tauri::command]
pub fn toggle_study_plan(
    state: State<'_, AppState>,
    id: i64,
    enabled: bool,
) -> AppResult<StudyPlan> {
    let conn = state.db.lock();
    state.db.plans(&conn).toggle(id, enabled)
}

/// Delete a plan by id.
#[tauri::command]
pub fn delete_study_plan(state: State<'_, AppState>, id: i64) -> AppResult<()> {
    let conn = state.db.lock();
    state.db.plans(&conn).delete(id)
}
