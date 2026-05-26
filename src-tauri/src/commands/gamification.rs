//! Gamification Tauri commands (Vague 1).
//!
//! White Hat surface area: read-only queries (`get_user_stats`,
//! `list_unlocked_achievements`) plus one explicit user-initiated action
//! (`use_streak_freeze`). The streak update path is **not** exposed: it lives
//! inside `submit_review` so the streak only grows from real learning effort.

use tauri::State;

use crate::app_state::AppState;
use crate::db::{Achievement, UserStats};
use crate::error::AppResult;

#[tauri::command]
pub fn get_user_stats(state: State<'_, AppState>) -> AppResult<UserStats> {
    let conn = state.db.lock();
    state.db.gamification(&conn).get_user_stats()
}

#[tauri::command]
pub fn use_streak_freeze(state: State<'_, AppState>) -> AppResult<UserStats> {
    let conn = state.db.lock();
    state.db.gamification(&conn).use_freeze()
}

#[tauri::command]
pub fn list_unlocked_achievements(state: State<'_, AppState>) -> AppResult<Vec<Achievement>> {
    let conn = state.db.lock();
    state.db.gamification(&conn).list_achievements()
}
