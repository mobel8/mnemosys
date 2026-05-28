//! Reading Import Tauri commands (Vague 17 — LingQ-style word tracking).
//!
//! Thin wrappers around [`crate::db::ReadingRepo`]. The repo owns all
//! normalisation + validation; these handlers only lock the connection and
//! map the IPC-friendly snake_case payloads.

use tauri::State;

use crate::app_state::AppState;
use crate::db::WordStatus;
use crate::error::AppResult;

/// Fetch the stored status of each word in `words` for `language`. Words with
/// no row are simply absent from the result (the UI treats them as `new`).
#[tauri::command]
pub fn get_word_statuses(
    state: State<'_, AppState>,
    words: Vec<String>,
    language: String,
) -> AppResult<Vec<WordStatus>> {
    let conn = state.db.lock();
    state.db.reading(&conn).get_word_statuses(&words, &language)
}

/// Upsert one word's status (`new` / `learning` / `known`). Idempotent.
#[tauri::command]
pub fn set_word_status(
    state: State<'_, AppState>,
    word: String,
    status: String,
    language: String,
) -> AppResult<WordStatus> {
    let conn = state.db.lock();
    state
        .db
        .reading(&conn)
        .set_word_status(&word, &status, &language)
}

/// Create one Basic card (front = word, back = placeholder) per distinct word
/// in `words`, inside `deck_id`. Returns the number of cards created.
#[tauri::command]
pub fn create_cards_from_words(
    state: State<'_, AppState>,
    deck_id: i64,
    words: Vec<String>,
) -> AppResult<usize> {
    let conn = state.db.lock();
    state
        .db
        .reading(&conn)
        .create_cards_from_words(deck_id, &words)
}
