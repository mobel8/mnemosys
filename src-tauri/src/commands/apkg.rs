//! Tauri commands for the Anki `.apkg` importer (Vague A2.3).
//!
//! Single entry point: [`import_apkg`] reads the file at `path`, parses it
//! and merges the resulting decks/notes into the live DB. Returns a
//! [`ConversionResult`] the UI can display ("N decks, M notes imported,
//! K skipped").

use tauri::State;

use crate::apkg::{convert_to_mnemosys, parse_apkg, ConversionResult};
use crate::app_state::AppState;
use crate::error::{AppError, AppResult};

/// Import an Anki `.apkg` from a local filesystem path.
///
/// Errors:
/// - `Io` — file unreadable.
/// - `Validation` — file isn't a `.apkg`, uses an unsupported container, or
///   the embedded `media` JSON is malformed.
/// - `Database` — SQLite read failure or downstream Mnemosys insert error.
#[tauri::command]
pub fn import_apkg(state: State<'_, AppState>, path: String) -> AppResult<ConversionResult> {
    let bytes = std::fs::read(&path)
        .map_err(|e| AppError::Validation(format!("Could not read .apkg at '{path}': {e}")))?;
    let collection = parse_apkg(&bytes)?;
    convert_to_mnemosys(&state.db, collection)
}
