//! Tauri command handlers for the cloud-sync feature (Session 3).
//!
//! These commands always go through one of three paths:
//!   1. **Not configured** — `supabase_url` / `supabase_anon_key` missing in
//!      `AppSettings`. Returns `AppError::Validation` with a localized hint
//!      so the UI can surface a clear « configure first » banner.
//!   2. **Configured but logged out** — login form, `sync_login` does the
//!      OAuth password-grant against Supabase Auth.
//!   3. **Active session** — `sync_now` runs one full cycle through
//!      [`crate::sync::cycle::run_cycle`].
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

/// Clock-skew margin (seconds) applied when deciding whether a session is
/// expired. We treat a token that dies within the next minute as already
/// expired so a refresh fires *before* an in-flight request can 401, rather
/// than racing the deadline.
const EXPIRY_SKEW_SECS: i64 = 60;

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
    // P033: sync_session.json holds the Supabase access + refresh JWTs in
    // cleartext. Restrict it to the current user (0600 on Unix) after each
    // flush until session storage moves to the OS keychain.
    crate::sync::harden_store_permissions(app, SESSION_FILE);
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

/// `true` when `session` is expired (or about to be, within [`EXPIRY_SKEW_SECS`]).
fn session_expired(session: &SyncSession, now: i64) -> bool {
    session.expires_at <= now + EXPIRY_SKEW_SECS
}

/// Return a usable session, transparently refreshing the access token when the
/// current one has expired (P042).
///
/// Supabase access tokens live ~1 h; the refresh token is long-lived. Before
/// this helper existed, `refresh` was implemented but never called, so every
/// sync past the first hour failed with « please log in again » even though a
/// valid refresh token sat in `sync_session.json`. Now:
///   * a still-valid session is returned untouched;
///   * an expired session with a refresh token triggers `auth::refresh`, whose
///     fresh bundle is persisted via `save_session` and returned;
///   * only a failed refresh (or a missing refresh token) surfaces the
///     actionable « log in again » error.
async fn ensure_fresh_session(
    app: &AppHandle,
    config: &SupabaseConfig,
    session: SyncSession,
) -> AppResult<SyncSession> {
    if !session_expired(&session, Utc::now().timestamp()) {
        return Ok(session);
    }
    if session.refresh_token.trim().is_empty() {
        return Err(AppError::Validation(
            "Session de synchronisation expirée. Reconnecte-toi.".into(),
        ));
    }
    let refreshed = auth::refresh(config, &session.refresh_token)
        .await
        .map_err(|_| {
            AppError::Validation("Session de synchronisation expirée. Reconnecte-toi.".into())
        })?;
    save_session(app, &refreshed)?;
    Ok(refreshed)
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
pub async fn sync_status(app: AppHandle, state: State<'_, AppState>) -> AppResult<SyncStatus> {
    let settings = load_settings(&app)?;
    let configured = settings
        .supabase_url
        .as_deref()
        .is_some_and(|u| !u.trim().is_empty())
        && settings
            .supabase_anon_key
            .as_deref()
            .is_some_and(|k| !k.trim().is_empty());

    // Resolve the effective session. When the access token has expired we try a
    // silent refresh (P042) so the UI keeps reporting « logged in » across the
    // ~1 h token lifetime instead of bouncing the user back to the login form.
    // The refresh is best-effort here: if it fails (or sync isn't configured)
    // we report `logged_in: false` without erroring the status query.
    let session: Option<SyncSession> = match load_session(&app).ok().flatten() {
        Some(current) if !session_expired(&current, Utc::now().timestamp()) => Some(current),
        Some(current) => match supabase_config(&settings) {
            Ok(config) => ensure_fresh_session(&app, &config, current).await.ok(),
            Err(_) => None,
        },
        None => None,
    };
    let logged_in = session.is_some();

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
        AppError::Validation(
            "La synchronisation requiert une session active. Connecte-toi d'abord.".into(),
        )
    })?;
    // Transparently refresh an expired access token before running the cycle
    // (P042). Only a failed refresh surfaces « please log in again ».
    let session = ensure_fresh_session(&app, &config, session).await?;

    cycle::run_cycle(&state.db, &config, &session).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session(expires_at: i64, refresh: &str) -> SyncSession {
        SyncSession {
            user_id: "u".into(),
            email: "a@b.c".into(),
            access_token: "access".into(),
            refresh_token: refresh.into(),
            expires_at,
        }
    }

    #[test]
    fn session_with_ample_lifetime_is_not_expired() {
        let now = 1_000_000;
        let s = session(now + 3600, "r");
        assert!(!session_expired(&s, now));
    }

    #[test]
    fn session_within_skew_window_counts_as_expired() {
        // P042: a token dying inside the skew margin must be treated as expired
        // so the refresh fires before an in-flight request can 401.
        let now = 1_000_000;
        let s = session(now + EXPIRY_SKEW_SECS - 1, "r");
        assert!(session_expired(&s, now));
    }

    #[test]
    fn past_deadline_is_expired() {
        let now = 1_000_000;
        assert!(session_expired(&session(now - 1, "r"), now));
        assert!(session_expired(&session(now, "r"), now));
    }
}
