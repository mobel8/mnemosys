//! Memory Palace Tauri commands (Vague 9 — method-of-loci).
//!
//! Thin wrappers around [`crate::db::PalaceRepo`] — no business logic
//! beyond clock injection and the IPC-friendly snake_case payload mapping.
//! Validation (name non-empty, template enum, coordinate finiteness) lives
//! either in the repo or here, with the repo as the source of truth.

use chrono::Utc;
use tauri::State;

use crate::app_state::AppState;
use crate::db::{Palace, PalaceLocus, PalaceWithLoci};
use crate::error::{AppError, AppResult};

/// Defensive guard so a misbehaving UI can't pin a card at (NaN, ∞, …)
/// and confuse the renderer or every later distance computation.
fn validate_xyz(x: f64, y: f64, z: f64) -> AppResult<()> {
    if !x.is_finite() || !y.is_finite() || !z.is_finite() {
        return Err(AppError::Validation(
            "locus coordinates must be finite numbers".into(),
        ));
    }
    Ok(())
}

#[tauri::command]
pub fn list_palaces(state: State<'_, AppState>) -> AppResult<Vec<Palace>> {
    let conn = state.db.lock();
    state.db.palaces(&conn).list()
}

#[tauri::command]
pub fn get_palace(state: State<'_, AppState>, id: i64) -> AppResult<PalaceWithLoci> {
    let conn = state.db.lock();
    state.db.palaces(&conn).get(id)
}

#[tauri::command]
pub fn create_palace(
    state: State<'_, AppState>,
    name: String,
    description: Option<String>,
    template: String,
) -> AppResult<Palace> {
    let now = Utc::now().timestamp();
    let conn = state.db.lock();
    state
        .db
        .palaces(&conn)
        .create(&name, description.as_deref(), &template, now)
}

#[tauri::command]
pub fn update_palace(
    state: State<'_, AppState>,
    id: i64,
    name: Option<String>,
    description: Option<Option<String>>,
    template: Option<String>,
) -> AppResult<Palace> {
    let now = Utc::now().timestamp();
    let conn = state.db.lock();
    // Map Option<Option<String>> → Option<Option<&str>> without dropping
    // the « clear vs leave alone » distinction.
    let desc_borrowed = description.as_ref().map(|inner| inner.as_deref());
    state
        .db
        .palaces(&conn)
        .update(id, name.as_deref(), desc_borrowed, template.as_deref(), now)
}

#[tauri::command]
pub fn delete_palace(state: State<'_, AppState>, id: i64) -> AppResult<()> {
    let conn = state.db.lock();
    state.db.palaces(&conn).delete(id)
}

#[tauri::command]
pub fn add_palace_locus(
    state: State<'_, AppState>,
    palace_id: i64,
    card_id: i64,
    x: f64,
    y: f64,
    z: f64,
    label: Option<String>,
) -> AppResult<PalaceLocus> {
    validate_xyz(x, y, z)?;
    let now = Utc::now().timestamp();
    let conn = state.db.lock();
    state
        .db
        .palaces(&conn)
        .add_locus(palace_id, card_id, x, y, z, label.as_deref(), now)
}

#[tauri::command]
pub fn remove_palace_locus(state: State<'_, AppState>, locus_id: i64) -> AppResult<()> {
    let conn = state.db.lock();
    state.db.palaces(&conn).remove_locus(locus_id)
}

#[tauri::command]
pub fn reorder_palace_loci(
    state: State<'_, AppState>,
    palace_id: i64,
    new_order: Vec<i64>,
) -> AppResult<()> {
    let conn = state.db.lock();
    state.db.palaces(&conn).reorder_loci(palace_id, &new_order)
}

#[tauri::command]
pub fn move_palace_locus(
    state: State<'_, AppState>,
    locus_id: i64,
    x: f64,
    y: f64,
    z: f64,
) -> AppResult<()> {
    validate_xyz(x, y, z)?;
    let conn = state.db.lock();
    state.db.palaces(&conn).move_locus(locus_id, x, y, z)
}
