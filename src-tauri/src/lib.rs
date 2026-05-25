//! Mnemosys — Rust backend (Tauri 2).
//!
//! Module map (foundation laid by agent A1):
//! - [`error`]    — shared `AppError` and `AppResult` types.
//! - [`db`]       — SQLite layer (filled by A2).
//! - [`fsrs`]     — FSRS scheduler wrapper (filled by A3).
//! - [`commands`] — Tauri `#[command]` handlers (filled by B-wave agents).
//!
//! `run()` is invoked from `main.rs` and registers all plugins. Additional
//! Tauri commands will be appended to `.invoke_handler(...)` by downstream
//! agents.

pub mod commands;
pub mod db;
pub mod error;
pub mod fsrs;

/// Entry point used by both `main.rs` (release) and integration tests.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        // tauri-plugin-sql is NOT registered (see Cargo.toml note).
        // A2 owns the rusqlite-based DB layer and exposes commands.
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .setup(|_app| {
            #[cfg(debug_assertions)]
            {
                // Useful early signal that the backend actually booted.
                eprintln!("[mnemosys] backend ready");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // B-wave agents register their commands here, e.g.:
            // commands::deck::list_decks,
            // commands::card::review_card,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
