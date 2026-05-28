//! Tauri command for the subtitle importer (Vague 11).
//!
//! Single entry point: [`import_subtitles`] reads a `.srt` / `.vtt` file,
//! parses its cues and inserts them into the chosen deck as sentence-mining
//! notes. Returns a [`SubtitleImportResult`] for the UI toast
//! ("N cues → M notes, K skipped").

use std::path::Path;

use tauri::State;

use crate::app_state::AppState;
use crate::error::{AppError, AppResult};
use crate::subtitles::{import_cues, parser, SubtitleImportResult, SubtitleMode};

/// Import a subtitle file from a local filesystem path.
///
/// `mode` is `"sentence"` (Basic front/back cards) or `"cloze"` (longest-word
/// deletion). The `.vtt` vs `.srt` distinction is taken from the file
/// extension; an unknown extension is treated as SRT (the more permissive of
/// the two parsers, since timing auto-detects `,` vs `.`).
///
/// Errors:
/// - `Validation` — file unreadable, not valid UTF-8, or an invalid `mode`.
/// - `NotFound` — `deck_id` doesn't exist.
/// - `Database` — a downstream SQLite insert failure.
#[tauri::command]
pub fn import_subtitles(
    state: State<'_, AppState>,
    path: String,
    deck_id: i64,
    mode: String,
) -> AppResult<SubtitleImportResult> {
    let mode = SubtitleMode::parse(&mode)?;

    let bytes = std::fs::read(&path)
        .map_err(|e| AppError::Validation(format!("Could not read subtitle file '{path}': {e}")))?;
    let content = String::from_utf8(bytes)
        .map_err(|_| AppError::Validation(format!("'{path}' is not valid UTF-8 text")))?;

    let is_vtt = Path::new(&path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("vtt"))
        .unwrap_or(false);

    let cues = parser::parse(&content, is_vtt);
    import_cues(&state.db, deck_id, &cues, mode, "subtitles")
}
