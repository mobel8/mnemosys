//! Deck-related Tauri commands.
//!
//! Mirrors [`DeckRepo`](crate::db::DeckRepo) for the frontend with a single
//! `AppState` lock per call. All commands run synchronously — SQLite calls
//! are sub-millisecond for the deck table.

use tauri::State;

use crate::app_state::AppState;
use crate::db::{Deck, DeckMastery, DeckPatch, DeckStats};
use crate::error::AppResult;
use crate::fsrs::DEFAULT_DESIRED_RETENTION;
use crate::scheduler::SchedulerKind;

#[tauri::command]
pub fn list_decks(state: State<'_, AppState>) -> AppResult<Vec<Deck>> {
    let conn = state.db.lock();
    state.db.decks(&conn).list()
}

#[tauri::command]
pub fn get_deck(state: State<'_, AppState>, id: i64) -> AppResult<Deck> {
    let conn = state.db.lock();
    state.db.decks(&conn).get(id)
}

#[tauri::command]
pub fn create_deck(
    state: State<'_, AppState>,
    name: String,
    description: Option<String>,
    color: String,
    desired_retention: Option<f64>,
    scheduler_kind: Option<SchedulerKind>,
    language_mode: Option<String>,
) -> AppResult<Deck> {
    let retention = desired_retention.unwrap_or(DEFAULT_DESIRED_RETENTION as f64);
    let conn = state.db.lock();
    state.db.decks(&conn).create(
        &name,
        description.as_deref(),
        &color,
        retention,
        scheduler_kind,
        language_mode.as_deref(),
    )
}

#[tauri::command]
pub fn update_deck(
    state: State<'_, AppState>,
    id: i64,
    patch: DeckPatch,
) -> AppResult<Deck> {
    let conn = state.db.lock();
    state.db.decks(&conn).update(id, patch)
}

#[tauri::command]
pub fn delete_deck(state: State<'_, AppState>, id: i64) -> AppResult<()> {
    let conn = state.db.lock();
    state.db.decks(&conn).delete(id)
}

#[tauri::command]
pub fn get_deck_stats(state: State<'_, AppState>, id: i64) -> AppResult<DeckStats> {
    let conn = state.db.lock();
    state.db.decks(&conn).stats(id)
}

#[tauri::command]
pub fn count_decks(state: State<'_, AppState>) -> AppResult<i64> {
    let conn = state.db.lock();
    state.db.decks(&conn).count()
}

#[tauri::command]
pub fn get_deck_mastery(state: State<'_, AppState>, id: i64) -> AppResult<DeckMastery> {
    let conn = state.db.lock();
    state.db.decks(&conn).mastery(id)
}
