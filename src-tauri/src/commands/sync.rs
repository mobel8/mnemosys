//! Tauri command handlers for the cloud-sync feature (Session 3).
//!
//! These commands always go through one of three paths:
//!   1. **Not configured** — `supabase_url` / `supabase_anon_key` missing in
//!      `AppSettings`. Returns `AppError::Validation` with a localized hint
//!      so the UI can surface a clear « configure first » banner.
//!   2. **Configured but logged out** — login form, `sync_login` does the
//!      OAuth password-grant against Supabase Auth.
//!   3. **Active session** — `sync_now` runs one full cycle through
//!      [`crate::sync::sync::run_cycle`].
//!
//! The JWT lives in `sync_session.json` (tauri-plugin-store). Removing the
//! file is equivalent to a logout.

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tauri_plugin_store::StoreExt;

use crate::app_state::AppState;
use crate::commands::settings::AppSettings;
use crate::error::{AppError, AppResult};
use crate::sync::{
    auth::{self, SupabaseConfig},
    cycle, SyncReport, SyncSession, SyncStatus,
};

const SESSION_FILE: &str = "sync_session.json";
const SESSION_KEY: &str = "session";
const SETTINGS_FILE: &str = "settings.json";
const SETTINGS_KEY: &str = "app_settings";

/// Read the persisted `AppSettings` blob; falls back to defaults when the
/// store has never been written. Centralised here so both the command
/// handlers and the helpers below stay in sync with `settings.rs`.
fn load_settings(app: &AppHandle) -> AppResult<AppSettings> {
    let store = app
        .store(SETTINGS_FILE)
        .map_err(|e| AppError::Other(format!("open settings store: {}", e)))?;
    match store.get(SETTINGS_KEY) {
        Some(value) => Ok(serde_json::from_value(value).unwrap_or_default()),
        None => Ok(AppSettings::default()),
    }
}

fn load_session(app: &AppHandle) -> AppResult<Option<SyncSession>> {
    let store = app
        .store(SESSION_FILE)
        .map_err(|e| AppError::Other(format!("open session store: {}", e)))?;
    match store.get(SESSION_KEY) {
        Some(value) => serde_json::from_value(value)
            .map(Some)
            .map_err(|e| AppError::Other(format!("decode session: {}", e))),
        None => Ok(None),
    }
}

fn save_session(app: &AppHandle, session: &SyncSession) -> AppResult<()> {
    let store = app
        .store(SESSION_FILE)
        .map_err(|e| AppError::Other(format!("open session store: {}", e)))?;
    store.set(SESSION_KEY, serde_json::to_value(session)?);
    store
        .save()
        .map_err(|e| AppError::Other(format!("save session store: {}", e)))?;
    Ok(())
}

fn clear_session(app: &AppHandle) -> AppResult<()> {
    let store = app
        .store(SESSION_FILE)
        .map_err(|e| AppError::Other(format!("open session store: {}", e)))?;
    store.delete(SESSION_KEY);
    store
        .save()
        .map_err(|e| AppError::Other(format!("save session store: {}", e)))?;
    Ok(())
}

fn supabase_config(settings: &AppSettings) -> AppResult<SupabaseConfig> {
    SupabaseConfig::from_settings(
        settings.supabase_url.as_deref(),
        settings.supabase_anon_key.as_deref(),
    )
}

/// Payload accepted by `sync_login`. Kept as a struct so the frontend can
/// pass a JSON object and benefit from Tauri's camelCase mapping.
#[derive(Debug, Deserialize)]
pub struct SyncLoginInput {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Serialize)]
pub struct SyncLoginOutput {
    pub session: SyncSession,
}

#[tauri::command]
pub async fn sync_login(
    app: AppHandle,
    email: String,
    password: String,
) -> AppResult<SyncLoginOutput> {
    let settings = load_settings(&app)?;
    let config = supabase_config(&settings)?;
    let session = auth::login(&config, &email, &password).await?;
    save_session(&app, &session)?;
    Ok(SyncLoginOutput { session })
}

#[tauri::command]
pub async fn sync_logout(app: AppHandle) -> AppResult<()> {
    let settings = load_settings(&app)?;
    let session = load_session(&app)?;
    if let (Ok(config), Some(s)) = (supabase_config(&settings), session.as_ref()) {
        // Server-side logout is best-effort; we wipe the local store
        // regardless of the outcome.
        let _ = auth::logout(&config, &s.access_token).await;
    }
    clear_session(&app)?;
    Ok(())
}

#[tauri::command]
pub fn sync_status(app: AppHandle, state: State<'_, AppState>) -> AppResult<SyncStatus> {
    let settings = load_settings(&app)?;
    let configured = settings.supabase_url.as_deref().is_some_and(|u| !u.trim().is_empty())
        && settings
            .supabase_anon_key
            .as_deref()
            .is_some_and(|k| !k.trim().is_empty());

    let session = load_session(&app).ok().flatten();
    let now = Utc::now().timestamp();
    let logged_in = match &session {
        Some(s) => s.expires_at > now,
        None => false,
    };

    let last_sync_at: Option<i64> = {
        let conn = state.db.lock();
        conn.query_row(
            "SELECT last_sync_at FROM sync_state WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .unwrap_or(None)
    };

    Ok(SyncStatus {
        configured,
        logged_in,
        email: session.map(|s| s.email),
        last_sync_at,
    })
}

#[tauri::command]
pub async fn sync_now(app: AppHandle, state: State<'_, AppState>) -> AppResult<SyncReport> {
    let settings = load_settings(&app)?;
    let config = supabase_config(&settings)?;
    let session = load_session(&app)?.ok_or_else(|| {
        AppError::Validation("Sync requires an active session. Please log in first.".into())
    })?;
    if session.expires_at <= Utc::now().timestamp() {
        return Err(AppError::Validation(
            "Sync session expired. Please log in again.".into(),
        ));
    }

    cycle::run_cycle(&state.db, &config, &session).await
}
