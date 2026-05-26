//! Tauri `#[command]` handlers — front-end facing API surface.
//!
//! Each feature lives in its own sub-module. `lib.rs::run()` re-exports the
//! command functions through `tauri::generate_handler![]`. Commands always
//! take a `tauri::State<'_, AppState>` (and sometimes a `tauri::AppHandle`
//! for plugin access) and return [`AppResult<T>`].

pub mod ai;
pub mod apkg;
pub mod cards;
pub mod decks;
pub mod demo;
pub mod io;
pub mod review;
pub mod settings;
pub mod stats;
pub mod tts;
