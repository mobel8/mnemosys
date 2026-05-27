//! Persisted user settings, stored via `tauri-plugin-store`.
//!
//! Stored in `settings.json` inside the app data dir (managed by the plugin).
//! The struct is the single source of truth — the frontend mirrors it as a
//! TypeScript type.
//!
//! Whenever the user changes `desired_retention`, [`save_settings`] also
//! rebuilds the live [`CardScheduler`](crate::fsrs::CardScheduler) so the
//! review preview reflects the new target immediately.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tauri_plugin_store::StoreExt;

use crate::app_state::AppState;
use crate::error::{AppError, AppResult};
use crate::fsrs::DEFAULT_DESIRED_RETENTION;

const STORE_FILE: &str = "settings.json";
const STORE_KEY: &str = "app_settings";

/// User-facing settings persisted across app launches.
///
/// `#[serde(default)]` on every optional field keeps payloads forward- and
/// backward-compatible: a settings.json written by an older build (without
/// the TTS fields) deserialises cleanly, and a new build's defaults survive
/// being shipped to an older binary (extra fields are tolerated by serde).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AppSettings {
    /// `"light" | "dark" | "system"`.
    pub theme: String,
    /// FSRS retention target in `[0.7, 0.97]`.
    pub desired_retention: f64,
    /// Cap on brand-new cards introduced per day.
    pub daily_new_limit: u32,
    /// Cap on review cards shown per day.
    pub daily_review_limit: u32,
    /// Toggles the "next interval" preview chips in the review UI.
    pub show_next_interval: bool,

    // --- Vague A2.2 (TTS) ----------------------------------------------------
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

    // --- Vague A2.1 (AI card generation) -------------------------------------
    /// Anthropic API key. `None` -> AI commands fall back to the
    /// `ANTHROPIC_API_KEY` env var and otherwise return a validation error.
    /// MVP: stored in plain settings.json. Session 3+ will move this to the
    /// OS keychain via `tauri-plugin-stronghold` or `keyring`.
    #[serde(default)]
    pub anthropic_api_key: Option<String>,

    // --- Session 3 (cloud sync) ---------------------------------------------
    /// Base URL of the user's Supabase project (e.g.
    /// `https://abcdef.supabase.co`). `None` keeps the sync subsystem
    /// dormant — every `sync_*` command returns `AppError::Validation` until
    /// this is filled in.
    #[serde(default)]
    pub supabase_url: Option<String>,
    /// Supabase project anon (public) key. Required alongside `supabase_url`
    /// because the REST gateway demands an `apikey` header even for
    /// authenticated calls. `None` -> sync stays dormant.
    #[serde(default)]
    pub supabase_anon_key: Option<String>,

    // --- Vague 2 (cognitive features) ---------------------------------------
    /// Generation-effect: when on, the learner types the expected answer
    /// before flipping the card (Slamecka & Graf 1978, d≈0.40). Defaults to
    /// off so the existing flip-then-rate UX stays untouched for current
    /// users.
    #[serde(default)]
    pub type_the_answer_enabled: bool,
    /// CBM — confidence-based marking (Gardner-Medwin, UCL). When on the
    /// learner rates 1..5 confidence BEFORE picking the FSRS rating; the
    /// value is stored as `reviews.confidence`.
    #[serde(default)]
    pub confidence_rating_enabled: bool,
    /// Pre-questioning IA: generate a handful of curiosity-priming questions
    /// at the start of each new-deck session (Pan et al. 2023, g≈0.45).
    /// Requires an Anthropic API key to be configured.
    #[serde(default)]
    pub pre_questioning_enabled: bool,

    // --- Vague 3 (neuro modes, opt-in) --------------------------------------
    /// Master switch for every neuro mode. Defaults to `false` so the app
    /// behaves exactly as before. When `false`, all three sub-toggles below
    /// are forced inert by the UI regardless of their stored value.
    #[serde(default)]
    pub neuro_modes_enabled: bool,
    /// Show the Mood / Sleep / Stress check-in modal before each session
    /// (when no log exists for today yet). Evidence: sleep deprivation
    /// reduces consolidation, meta-analysis g≈0.621.
    #[serde(default)]
    pub mood_checkin_enabled: bool,
    /// Cadence of the movement-break overlay in minutes. UI clamps to
    /// `[10, 60]`; default `25` matches the Pomodoro timing Roig et al.
    /// recommend for acute exercise + memory consolidation (d≈0.52).
    #[serde(default = "default_movement_break_minutes")]
    pub movement_break_minutes: u32,
    /// Offer a 5-min cyclic-sighing primer before sessions when stress is
    /// flagged. Source: Spiegel et al., Cell Reports Medicine 2023.
    #[serde(default)]
    pub cyclic_sighing_enabled: bool,

    // --- Vague 7 (Tier S — sketch + delayed JOL) ----------------------------
    /// Drawing effect: when on, the learner sketches their guess on a
    /// canvas BEFORE flipping the card. Wammes et al. 2016/2018 measured a
    /// 30-50% boost on free recall. Stored as PNG data URLs in
    /// `review_sketches`. Defaults to off to keep the existing UX intact.
    #[serde(default)]
    pub sketch_before_flip_enabled: bool,
    /// Delayed Judgments of Learning: the learner predicts their own
    /// recall probability shortly after studying a card; the prompt fires
    /// `jol_delay_minutes` later. Rhodes & Tauber 2011 meta-analysis
    /// reports γ ≈ 0.93 on resolution.
    #[serde(default)]
    pub delayed_jol_enabled: bool,
    /// Delay (in minutes) between the initial review and the delayed JOL
    /// prompt. UI clamps to `[5, 120]`; default 30 matches the « optimal »
    /// gap reported in the meta-analysis.
    #[serde(default = "default_jol_delay_minutes")]
    pub jol_delay_minutes: u32,
}

fn default_movement_break_minutes() -> u32 {
    25
}

fn default_jol_delay_minutes() -> u32 {
    30
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: "system".into(),
            desired_retention: DEFAULT_DESIRED_RETENTION as f64,
            daily_new_limit: 20,
            daily_review_limit: 200,
            show_next_interval: true,
            // TTS defaults: nothing persisted until the user touches Settings.
            openai_api_key: None,
            tts_voice: None,
            tts_speed: None,
            // AI defaults: same — no key persisted until the user sets one.
            anthropic_api_key: None,
            // Sync stays dormant out of the box.
            supabase_url: None,
            supabase_anon_key: None,
            // Vague 2 cognitive features all opt-in.
            type_the_answer_enabled: false,
            confidence_rating_enabled: false,
            pre_questioning_enabled: false,
            // Vague 3 neuro modes — all opt-in, master switch off.
            neuro_modes_enabled: false,
            mood_checkin_enabled: false,
            movement_break_minutes: default_movement_break_minutes(),
            cyclic_sighing_enabled: false,
            // Vague 7 Tier S — both features opt-in.
            sketch_before_flip_enabled: false,
            delayed_jol_enabled: false,
            jol_delay_minutes: default_jol_delay_minutes(),
        }
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
            let parsed: AppSettings = serde_json::from_value(value).unwrap_or_default();
            Ok(parsed)
        }
        None => {
            // Seed with defaults on first launch so the frontend always
            // reads the same shape back.
            let defaults = AppSettings::default();
            store.set(STORE_KEY, serde_json::to_value(&defaults)?);
            let _ = store.save();
            Ok(defaults)
        }
    }
}

#[tauri::command]
pub fn save_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    settings: AppSettings,
) -> AppResult<()> {
    // Validate retention up-front so the persisted blob is always consistent.
    if !(0.7..=0.97).contains(&settings.desired_retention) {
        return Err(AppError::Validation(
            "desired_retention must be in [0.7, 0.97]".into(),
        ));
    }
    if !matches!(settings.theme.as_str(), "light" | "dark" | "system") {
        return Err(AppError::Validation(format!(
            "invalid theme: {}",
            settings.theme
        )));
    }
    if !(10..=60).contains(&settings.movement_break_minutes) {
        return Err(AppError::Validation(format!(
            "movement_break_minutes out of range (10-60): {}",
            settings.movement_break_minutes
        )));
    }
    if !(5..=120).contains(&settings.jol_delay_minutes) {
        return Err(AppError::Validation(format!(
            "jol_delay_minutes out of range (5-120): {}",
            settings.jol_delay_minutes
        )));
    }

    let store = app
        .store(STORE_FILE)
        .map_err(|e| AppError::Other(format!("open settings store: {}", e)))?;
    store.set(STORE_KEY, serde_json::to_value(&settings)?);
    store
        .save()
        .map_err(|e| AppError::Other(format!("save settings store: {}", e)))?;

    // Rebuild the FSRS scheduler so the new retention target takes effect
    // without the user needing to restart the app.
    state.rebuild_scheduler(settings.desired_retention as f32)?;

    Ok(())
}
