//! Persisted user settings, stored via `tauri-plugin-store`.
//!
//! Stored in `settings.json` inside the app data dir (managed by the plugin).
//! The struct is the single source of truth — the frontend mirrors it as a
//! TypeScript type.
//!
//! v0.11 — the settings surface was cut from ~33 fields to the ones that
//! drive real behaviour. Removed (their features were deleted or were
//! placebos): Supabase sync, pre-questioning, neuro modes (mood check-in,
//! movement break, cyclic sighing), delayed JOL, pretest mode,
//! self-explanation, focus guard (webgazer was dropped long ago — the toggle
//! was a no-op), chronotype. Unknown fields in an existing settings.json are
//! tolerated by serde, so upgrading is seamless.

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

use crate::error::{AppError, AppResult};
use crate::fsrs::DEFAULT_DESIRED_RETENTION;

const STORE_FILE: &str = "settings.json";
const STORE_KEY: &str = "app_settings";

/// User-facing settings persisted across app launches.
///
/// `#[serde(default)]` on every optional field keeps payloads forward- and
/// backward-compatible: a settings.json written by an older build
/// deserialises cleanly, and extra fields are tolerated by serde.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AppSettings {
    /// `"light" | "dark" | "system"`.
    pub theme: String,
    /// Default FSRS retention target for NEW decks, in `[0.7, 0.97]`.
    /// Scheduling always uses the per-deck retention (P006); this value only
    /// seeds the deck-creation dialog.
    pub desired_retention: f64,
    /// Cap on brand-new cards introduced per day.
    pub daily_new_limit: u32,
    /// Cap on review cards shown per day.
    pub daily_review_limit: u32,
    /// Toggles the "next interval" preview chips in the review UI.
    pub show_next_interval: bool,

    // --- TTS -----------------------------------------------------------------
    /// OpenAI API key. `None` -> TTS commands fall back to the
    /// `OPENAI_API_KEY` env var and otherwise return a validation error.
    #[serde(default)]
    pub openai_api_key: Option<String>,
    /// Preferred TTS voice slug (`"nova"`, `"alloy"`, ...). UI default = `"nova"`.
    #[serde(default)]
    pub tts_voice: Option<String>,
    /// Playback rate handed to OpenAI TTS (`0.25..=4.0`). UI default = `1.0`.
    #[serde(default)]
    pub tts_speed: Option<f32>,

    // --- Local offline TTS via Piper ----------------------------------------
    /// When on, the speaker button synthesises speech locally through the
    /// Piper CLI instead of OpenAI (offline + free + private). Defaults off.
    #[serde(default)]
    pub piper_enabled: bool,
    /// Path to the Piper binary. Empty/absent -> the backend uses the bare
    /// name `"piper"` and resolves it through `$PATH`.
    #[serde(default)]
    pub piper_binary_path: String,
    /// Path to the `.onnx` Piper voice model. Empty/absent -> local synthesis
    /// returns an actionable "download a voice model" error.
    #[serde(default)]
    pub piper_model_path: String,

    // --- AI card generation --------------------------------------------------
    /// Anthropic API key. `None` -> AI commands fall back to the
    /// `ANTHROPIC_API_KEY` env var and otherwise return a validation error.
    #[serde(default)]
    pub anthropic_api_key: Option<String>,

    // --- Active recall options (the methods that earned their keep) ---------
    /// Generation effect: when on, the learner types the expected answer
    /// before flipping the card. Also covers the pretesting effect on new
    /// cards (answer-before-seeing). Defaults off.
    #[serde(default)]
    pub type_the_answer_enabled: bool,
    /// CBM — confidence-based marking. When on the learner rates 1..5
    /// confidence BEFORE the flip; stored as `reviews.confidence` and feeds
    /// the calibration dashboard. Defaults off.
    #[serde(default)]
    pub confidence_rating_enabled: bool,

    // --- Labs (kept, off by default, zero impact when off) ------------------
    /// Drawing effect: sketch a guess on a canvas before flipping (Labs).
    #[serde(default)]
    pub sketch_before_flip_enabled: bool,
    /// Voice answer via Whisper transcription inside type-the-answer
    /// (requires an OpenAI key). Defaults off.
    #[serde(default)]
    pub voice_answer_enabled: bool,
    /// Hands-free review mode (TTS + voice grading, Labs). Defaults off.
    #[serde(default)]
    pub hands_free_enabled: bool,
    /// Context ambient sound played during review sessions.
    /// `"none" | "white" | "pink" | "brown" | "rain"`. Defaults `"none"`.
    #[serde(default = "default_ambient_sound")]
    pub ambient_sound: String,

    // --- Local AI (Ollama) ----------------------------------------------------
    /// When on, the AI generator uses a local Ollama LLM instead of Claude.
    #[serde(default)]
    pub ollama_enabled: bool,
    /// Base URL of the local Ollama daemon. Empty/absent -> `http://localhost:11434`.
    #[serde(default)]
    pub ollama_url: Option<String>,
    /// Ollama model slug (e.g. `"llama3.2"`). Empty/absent -> `llama3.2`.
    #[serde(default)]
    pub ollama_model: Option<String>,
}

fn default_ambient_sound() -> String {
    "none".to_string()
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: "system".into(),
            desired_retention: DEFAULT_DESIRED_RETENTION as f64,
            daily_new_limit: 20,
            daily_review_limit: 200,
            show_next_interval: true,
            openai_api_key: None,
            tts_voice: None,
            tts_speed: None,
            piper_enabled: false,
            piper_binary_path: String::new(),
            piper_model_path: String::new(),
            anthropic_api_key: None,
            type_the_answer_enabled: false,
            confidence_rating_enabled: false,
            sketch_before_flip_enabled: false,
            voice_answer_enabled: false,
            hands_free_enabled: false,
            ambient_sound: default_ambient_sound(),
            ollama_enabled: false,
            ollama_url: None,
            ollama_model: None,
        }
    }
}

/// P033 — settings.json holds API keys in cleartext until they move to the OS
/// keychain. Restrict the file to the current user where the platform allows
/// it (0600 on Unix; Windows user profiles are already per-user ACL'd).
fn harden_store_permissions(app: &AppHandle, file: &str) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        use tauri::Manager;
        if let Ok(dir) = app.path().app_data_dir() {
            let path = dir.join(file);
            if let Ok(meta) = std::fs::metadata(&path) {
                let mut perms = meta.permissions();
                perms.set_mode(0o600);
                let _ = std::fs::set_permissions(&path, perms);
            }
        }
    }
    #[cfg(not(unix))]
    {
        let _ = (app, file);
    }
}

#[tauri::command]
pub fn get_settings(app: AppHandle) -> AppResult<AppSettings> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| AppError::Other(format!("open settings store: {}", e)))?;
    let raw = store.get(STORE_KEY);
    match raw {
        Some(value) => {
            // Never silently wipe a user's settings (API keys included): if the
            // persisted blob doesn't deserialize, log loudly and fall back to
            // defaults WITHOUT overwriting the file — the next successful
            // save_settings is the only thing allowed to rewrite it.
            match serde_json::from_value::<AppSettings>(value) {
                Ok(parsed) => Ok(parsed),
                Err(e) => {
                    log::error!(
                        "settings.json failed to deserialize ({e}); serving defaults \
                         without overwriting the stored blob"
                    );
                    Ok(AppSettings::default())
                }
            }
        }
        None => {
            // Seed with defaults on first launch so the frontend always
            // reads the same shape back.
            let defaults = AppSettings::default();
            store.set(STORE_KEY, serde_json::to_value(&defaults)?);
            let _ = store.save();
            harden_store_permissions(&app, STORE_FILE);
            Ok(defaults)
        }
    }
}

#[tauri::command]
pub fn save_settings(app: AppHandle, settings: AppSettings) -> AppResult<()> {
    // Validate up-front so the persisted blob is always consistent.
    // P031 — messages d'erreur en français (source de vérité = le backend).
    if !(0.7..=0.97).contains(&settings.desired_retention) {
        return Err(AppError::Validation(
            "La rétention cible doit être comprise entre 0,7 et 0,97.".into(),
        ));
    }
    if !matches!(settings.theme.as_str(), "light" | "dark" | "system") {
        return Err(AppError::Validation(format!(
            "Thème invalide : {}",
            settings.theme
        )));
    }
    // P067 — borner les quotas journaliers côté backend (source de vérité).
    if !(1..=200).contains(&settings.daily_new_limit) {
        return Err(AppError::Validation(format!(
            "Le nombre de nouvelles cartes par jour doit être compris entre 1 et 200 (reçu : {}).",
            settings.daily_new_limit
        )));
    }
    if !(10..=1000).contains(&settings.daily_review_limit) {
        return Err(AppError::Validation(format!(
            "Le nombre de révisions par jour doit être compris entre 10 et 1000 (reçu : {}).",
            settings.daily_review_limit
        )));
    }
    if !matches!(
        settings.ambient_sound.as_str(),
        "none" | "white" | "pink" | "brown" | "rain"
    ) {
        return Err(AppError::Validation(format!(
            "Ambiance sonore invalide : {}",
            settings.ambient_sound
        )));
    }

    let store = app
        .store(STORE_FILE)
        .map_err(|e| AppError::Other(format!("open settings store: {}", e)))?;
    store.set(STORE_KEY, serde_json::to_value(&settings)?);
    store
        .save()
        .map_err(|e| AppError::Other(format!("save settings store: {}", e)))?;
    harden_store_permissions(&app, STORE_FILE);

    Ok(())
}
