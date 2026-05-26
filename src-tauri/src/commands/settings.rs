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
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: "system".into(),
            desired_retention: DEFAULT_DESIRED_RETENTION as f64,
            daily_new_limit: 20,
            daily_review_limit: 200,
            show_next_interval: true,
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
