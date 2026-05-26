//! Note + card management commands.
//!
//! Note creation also creates the matching card rows (handled inside
//! [`NoteRepo::create`](crate::db::NoteRepo::create)). The frontend
//! therefore only calls `create_note` to add new SRS content.

use tauri::State;

use crate::app_state::AppState;
use crate::db::{Card, CardWithNote, Note, NoteTemplate};
use crate::error::AppResult;

#[tauri::command]
pub fn list_cards_in_deck(
    state: State<'_, AppState>,
    deck_id: i64,
    limit: u32,
    offset: u32,
) -> AppResult<Vec<CardWithNote>> {
    let conn = state.db.lock();
    state.db.cards(&conn).list_in_deck(deck_id, limit, offset)
}

#[tauri::command]
pub fn search_notes(
    state: State<'_, AppState>,
    query: String,
    limit: u32,
) -> AppResult<Vec<Note>> {
    let conn = state.db.lock();
    state.db.notes(&conn).search(&query, limit)
}

#[tauri::command]
pub fn create_note(
    state: State<'_, AppState>,
    deck_id: i64,
    template: NoteTemplate,
    fields: serde_json::Value,
    tags: Vec<String>,
) -> AppResult<Note> {
    let conn = state.db.lock();
    state.db.notes(&conn).create(deck_id, template, fields, tags)
}

#[tauri::command]
pub fn update_note(
    state: State<'_, AppState>,
    id: i64,
    fields: serde_json::Value,
) -> AppResult<Note> {
    let conn = state.db.lock();
    state.db.notes(&conn).update_fields(id, fields)
}

#[tauri::command]
pub fn delete_note(state: State<'_, AppState>, id: i64) -> AppResult<()> {
    let conn = state.db.lock();
    state.db.notes(&conn).delete(id)
}

#[tauri::command]
pub fn suspend_card(
    state: State<'_, AppState>,
    id: i64,
    suspended: bool,
) -> AppResult<()> {
    let conn = state.db.lock();
    state.db.cards(&conn).suspend(id, suspended)
}

/// Reset a card to `new`, clearing every FSRS scheduling field.
///
/// The `reviews` history is intentionally preserved so retention stats stay
/// truthful. Returns the freshly-reset card so the UI can re-render it.
#[tauri::command]
pub fn reset_card(state: State<'_, AppState>, id: i64) -> AppResult<Card> {
    let conn = state.db.lock();
    state.db.cards(&conn).reset(id)
}
