//! Mnemosys — Rust backend (Tauri 2).
//!
//! Module map:
//! - [`error`]     — shared `AppError` and `AppResult` types.
//! - [`db`]        — SQLite layer (rusqlite).
//! - [`fsrs`]      — FSRS-6 scheduler wrapper.
//! - [`ai`]        — Claude-powered flashcard generation (Vague A2.1).
//! - [`tts`]       — text-to-speech (OpenAI + on-disk cache, Vague A2.2).
//! - [`apkg`]      — Anki `.apkg` importer (Vague A2.3).
//! - [`subtitles`] — `.srt` / `.vtt` subtitle importer (Vague 11).
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
pub mod scheduler;
pub mod subtitles;
pub mod sync;
pub mod tts;

use tauri::Manager;

use crate::app_state::AppState;

/// Entry point used by both `main.rs` (release) and integration tests.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        // tauri-plugin-sql is intentionally NOT registered — rusqlite owns
        // the DB layer and exposes #[tauri::command] handlers.
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_notification::init());

    // Auto-updater (Session 4) — OPT-IN behind the `updater` Cargo feature,
    // OFF by default. SECURITY (P036): never register it with an empty signing
    // `pubkey` + a live `endpoints` URL (supply-chain RCE). Build with
    // `--features updater` only once a real minisign pubkey is committed in
    // `tauri.conf.json::plugins.updater`. See `docs/SESSION_4_RELEASE.md`.
    #[cfg(feature = "updater")]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());

    builder
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
            commands::decks::get_decks_with_stats,
            commands::decks::count_decks,
            commands::decks::get_deck_mastery,
            commands::decks::get_deck_mastery_status,
            // cards / notes
            commands::cards::list_cards_in_deck,
            commands::cards::get_card_with_note,
            commands::cards::search_notes,
            commands::cards::create_note,
            commands::cards::update_note,
            commands::cards::delete_note,
            commands::cards::suspend_card,
            commands::cards::reset_card,
            commands::cards::get_frequency_coverage,
            // knowledge graph (Vague 11 — tag co-occurrence)
            commands::cards::get_tag_graph,
            // subtitle import (Vague 11 — .srt / .vtt sentence-mining)
            commands::subtitles::import_subtitles,
            // review
            commands::review::get_due_cards,
            commands::review::get_interleaved_due_cards,
            commands::review::preview_next_states,
            commands::review::submit_review,
            // stats
            commands::stats::get_today_stats,
            commands::stats::get_reviews_by_day,
            commands::stats::get_retention_by_day,
            // concept mastery (Vague 20 — Bayesian Knowledge Tracing)
            commands::mastery::get_concept_mastery,
            // temporal mastery graph (Vague 23 — retention trajectory by week/tag)
            commands::mastery::get_mastery_timeline,
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
            // local offline TTS via Piper (Vague 22)
            commands::tts::synthesize_audio_local,
            commands::tts::clear_tts_cache,
            commands::tts::get_tts_cache_size,
            // ai (Vague A2.1)
            commands::ai::generate_cards_text,
            commands::ai::generate_cards_pdf,
            commands::ai::generate_card_elaboration,
            // local AI (Vague 18 — Ollama)
            commands::ai::generate_cards_local,
            // multi-agent pipeline + mnemonic helper (Vague 13)
            commands::ai::critique_generated_cards,
            commands::ai::generate_card_mnemonic,
            // mnemonic image via DALL-E (Vague 22)
            commands::ai::generate_card_mnemonic_image,
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
            // gamification (Vague 1 — White Hat)
            commands::gamification::get_user_stats,
            commands::gamification::use_streak_freeze,
            commands::gamification::list_unlocked_achievements,
            // cognitive features (Vague 2 — type-the-answer, confidence rating, pre-questioning)
            commands::cognitive::generate_pre_questions,
            // wellness (Vague 3 — neuro modes opt-in)
            commands::wellness::submit_wellness_log,
            commands::wellness::get_today_wellness,
            commands::wellness::get_recent_wellness,
            // sketches (Vague 7 — drawing effect, Wammes 2016)
            commands::sketches::save_sketch,
            commands::sketches::get_card_sketches,
            // metacognition (Vague 7 — delayed JOL + calibration)
            commands::metacognition::record_jol,
            commands::metacognition::get_pending_jols,
            commands::metacognition::get_calibration_stats,
            // podcast (Vague 8 — Deck Podcast NotebookLM-style)
            commands::podcast::generate_deck_podcast,
            commands::podcast::list_deck_podcasts,
            commands::podcast::delete_podcast,
            // whisper (Vague 8 — voice answer transcription)
            commands::whisper::transcribe_voice_answer,
            // palaces (Vague 9 — Memory Palace 3D Builder)
            commands::palaces::list_palaces,
            commands::palaces::get_palace,
            commands::palaces::create_palace,
            commands::palaces::update_palace,
            commands::palaces::delete_palace,
            commands::palaces::add_palace_locus,
            commands::palaces::remove_palace_locus,
            commands::palaces::reorder_palace_loci,
            commands::palaces::move_palace_locus,
            // reading import (Vague 17 — LingQ-style word tracking)
            commands::reading::get_word_statuses,
            commands::reading::set_word_status,
            commands::reading::create_cards_from_words,
            // study plans (Vague 21 — Implementation Intentions, Gollwitzer 1999)
            commands::plans::list_study_plans,
            commands::plans::create_study_plan,
            commands::plans::update_study_plan,
            commands::plans::toggle_study_plan,
            commands::plans::delete_study_plan,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
