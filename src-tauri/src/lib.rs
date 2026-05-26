//! Mnemosys — Rust backend (Tauri 2).
//!
//! Module map:
//! - [`error`]     — shared `AppError` and `AppResult` types.
//! - [`db`]        — SQLite layer (rusqlite).
//! - [`fsrs`]      — FSRS-6 scheduler wrapper.
//! - [`ai`]        — Claude-powered flashcard generation (Vague A2.1).
//! - [`tts`]       — text-to-speech (OpenAI + on-disk cache, Vague A2.2).
//! - [`apkg`]      — Anki `.apkg` importer (Vague A2.3).
//! - [`commands`]  — Tauri `#[command]` handlers (frontend-facing API).
//! - [`app_state`] — `AppState` bundling DB + scheduler, registered via
//!   `app.manage(...)` in [`run`].
//!
//! `run()` is invoked from `main.rs` and registers all plugins, builds the
//! shared `AppState` from `<app_data_dir>/mnemosys.db`, and wires every
//! Tauri command into the invoke handler.

pub mod ai;
pub mod apkg;
pub mod app_state;
pub mod commands;
pub mod db;
pub mod error;
pub mod fsrs;
pub mod sync;
pub mod tts;

use tauri::Manager;

use crate::app_state::AppState;

/// Entry point used by both `main.rs` (release) and integration tests.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        // tauri-plugin-sql is intentionally NOT registered — rusqlite owns
        // the DB layer and exposes #[tauri::command] handlers.
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        // Auto-updater (Session 4). The plugin is registered unconditionally
        // so a release build can hot-swap binaries when a manifest server
        // becomes available, but it stays dormant until the `endpoints` /
        // `pubkey` fields in `tauri.conf.json::plugins.updater` point at a
        // real server. See `docs/SESSION_4_RELEASE.md` for the workflow.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            // Resolve `<app_data_dir>/mnemosys.db`. `app_data_dir()` on
            // Linux gives `~/.local/share/<bundle id>`; we create the
            // directory ourselves so a brand-new install doesn't crash on
            // first boot.
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app_data_dir");
            if !app_data_dir.exists() {
                std::fs::create_dir_all(&app_data_dir)?;
            }
            let db_path = app_data_dir.join("mnemosys.db");

            let state = AppState::new(db_path)?;
            app.manage(state);

            #[cfg(debug_assertions)]
            {
                eprintln!("[mnemosys] backend ready — db at app_data_dir/mnemosys.db");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // decks
            commands::decks::list_decks,
            commands::decks::get_deck,
            commands::decks::create_deck,
            commands::decks::update_deck,
            commands::decks::delete_deck,
            commands::decks::get_deck_stats,
            commands::decks::count_decks,
            // cards / notes
            commands::cards::list_cards_in_deck,
            commands::cards::search_notes,
            commands::cards::create_note,
            commands::cards::update_note,
            commands::cards::delete_note,
            commands::cards::suspend_card,
            commands::cards::reset_card,
            // review
            commands::review::get_due_cards,
            commands::review::preview_next_states,
            commands::review::submit_review,
            // stats
            commands::stats::get_today_stats,
            commands::stats::get_reviews_by_day,
            commands::stats::get_retention_by_day,
            // demo
            commands::demo::load_demo_decks,
            // settings
            commands::settings::get_settings,
            commands::settings::save_settings,
            // import / export
            commands::io::export_json,
            commands::io::import_json,
            // tts (Vague A2.2)
            commands::tts::synthesize_audio,
            commands::tts::clear_tts_cache,
            commands::tts::get_tts_cache_size,
            // ai (Vague A2.1)
            commands::ai::generate_cards_text,
            commands::ai::generate_cards_pdf,
            // apkg (Vague A2.3)
            commands::apkg::import_apkg,
            // media (image-occlusion template)
            commands::media::copy_image_to_app_data,
            // sync (Session 3 — Supabase cloud sync scaffolding)
            commands::sync::sync_login,
            commands::sync::sync_logout,
            commands::sync::sync_status,
            commands::sync::sync_now,
            // fsrs optimizer (Session 4)
            commands::fsrs_optimizer::get_total_reviews_count,
            commands::fsrs_optimizer::optimize_fsrs_params,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
