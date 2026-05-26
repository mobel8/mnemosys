//! Demo data loader (stub).
//!
//! Returns the number of decks that were loaded so the UI can flash a toast
//! ("Loaded N demo decks"). Agent C1 will replace the body with real fixture
//! loading once the demo data ships under `assets/demo_decks/`.

use tauri::State;

use crate::app_state::AppState;
use crate::error::AppResult;

#[tauri::command]
pub fn load_demo_decks(_state: State<'_, AppState>) -> AppResult<usize> {
    // TODO(C1): bundle demo decks and ingest them via NoteRepo::create.
    Ok(0)
}
