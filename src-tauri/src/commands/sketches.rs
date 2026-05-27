//! Sketch Tauri commands (Vague 7 — drawing effect).
//!
//! Surface is minimal on purpose: one « save » (called after `submit_review`
//! when the toggle is on) plus one « list past sketches for a card » for
//! the future « show me last time's drawing » UI. The data URL payload is
//! passed through verbatim; size validation lives at the command layer so
//! a misbehaving UI can't store a 5 MB blob and balloon the DB file.

use chrono::Utc;
use tauri::State;

use crate::app_state::AppState;
use crate::db::Sketch;
use crate::error::{AppError, AppResult};

/// Maximum accepted PNG payload size, in characters of the data: URL.
/// 800×400 sketches with simple pencil strokes typically fall well below
/// 100 KB; the 250 KB ceiling here is a defensive guard, not a tight cap.
const MAX_SKETCH_BYTES: usize = 250_000;

#[tauri::command]
pub fn save_sketch(
    state: State<'_, AppState>,
    review_id: i64,
    card_id: i64,
    sketch_data: String,
) -> AppResult<Sketch> {
    if sketch_data.is_empty() {
        return Err(AppError::Validation("sketch_data is empty".into()));
    }
    if sketch_data.len() > MAX_SKETCH_BYTES {
        return Err(AppError::Validation(format!(
            "sketch_data exceeds {} bytes",
            MAX_SKETCH_BYTES
        )));
    }
    if !sketch_data.starts_with("data:image/") {
        return Err(AppError::Validation(
            "sketch_data must be a data:image/* URL".into(),
        ));
    }
    let now = Utc::now().timestamp();
    let conn = state.db.lock();
    state
        .db
        .sketches(&conn)
        .insert(review_id, card_id, &sketch_data, now)
}

#[tauri::command]
pub fn get_card_sketches(
    state: State<'_, AppState>,
    card_id: i64,
    limit: u32,
) -> AppResult<Vec<Sketch>> {
    let conn = state.db.lock();
    state.db.sketches(&conn).get_for_card(card_id, limit.min(50))
}
