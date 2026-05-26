//! Supabase Auth — login/logout/refresh helpers.
//!
//! This file is intentionally a thin shell: the only structural moving part
//! is the JSON shape of Supabase's token endpoint. If the project URL or the
//! anon key are missing, every public helper returns
//! `AppError::Validation(...)` straight away — that's the « sync not
//! configured » contract documented in the design doc.
//!
//! No tests live here because they would either hit the network (forbidden
//! in CI) or mock reqwest at a level deeper than what the scaffolding needs.
//! Authentication is exercised end-to-end the moment Session 4 wires a
//! staging project.

use chrono::Utc;
use serde::Deserialize;

use crate::error::{AppError, AppResult};

use super::SyncSession;

/// Minimal config snapshot needed to dial Supabase. Built from `AppSettings`
/// by the calling Tauri command — keeps `auth.rs` free of Tauri imports.
#[derive(Debug, Clone)]
pub struct SupabaseConfig {
    pub url: String,
    pub anon_key: String,
}

impl SupabaseConfig {
    /// Returns a config when both fields are populated; otherwise emits the
    /// canonical « not configured » error. The empty-string check guards
    /// against `Some("")` slipping in from the settings UI.
    pub fn from_settings(url: Option<&str>, anon_key: Option<&str>) -> AppResult<Self> {
        let url = url
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| {
                AppError::Validation(
                    "Sync not configured. Configure Supabase URL in settings.".into(),
                )
            })?;
        let anon_key = anon_key
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| {
                AppError::Validation(
                    "Sync not configured. Configure Supabase anon key in settings.".into(),
                )
            })?;
        Ok(SupabaseConfig {
            url: url.trim_end_matches('/').to_string(),
            anon_key: anon_key.to_string(),
        })
    }
}

/// Raw response payload returned by `POST /auth/v1/token?grant_type=password`.
#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: String,
    expires_in: i64,
    user: AuthUser,
}

#[derive(Debug, Deserialize)]
struct AuthUser {
    id: String,
    email: Option<String>,
}

/// Issue a password-grant request against Supabase Auth and convert the
/// response into a [`SyncSession`].
///
/// Network errors (DNS, TLS, 5xx) are mapped to `AppError::Other` so the
/// frontend can surface them in a toast without leaking the underlying
/// reqwest details. A non-2xx HTTP status is folded into `AppError::Validation`
/// because the most common case is « wrong password » — actionable user input.
pub async fn login(
    config: &SupabaseConfig,
    email: &str,
    password: &str,
) -> AppResult<SyncSession> {
    if email.trim().is_empty() {
        return Err(AppError::Validation("email must not be empty".into()));
    }
    if password.is_empty() {
        return Err(AppError::Validation("password must not be empty".into()));
    }

    let endpoint = format!("{}/auth/v1/token?grant_type=password", config.url);
    let body = serde_json::json!({
        "email": email,
        "password": password,
    });

    let client = reqwest::Client::new();
    let resp = client
        .post(&endpoint)
        .header("apikey", &config.anon_key)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Other(format!("supabase auth request failed: {}", e)))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let detail = resp.text().await.unwrap_or_default();
        return Err(AppError::Validation(format!(
            "supabase auth returned {}: {}",
            status, detail
        )));
    }

    let parsed: TokenResponse = resp
        .json()
        .await
        .map_err(|e| AppError::Other(format!("decode auth response: {}", e)))?;

    let expires_at = Utc::now().timestamp().saturating_add(parsed.expires_in);

    Ok(SyncSession {
        user_id: parsed.user.id,
        email: parsed.user.email.unwrap_or_else(|| email.to_string()),
        access_token: parsed.access_token,
        refresh_token: parsed.refresh_token,
        expires_at,
    })
}

/// Trade an existing refresh token for a fresh access token. Same error
/// mapping as [`login`].
pub async fn refresh(config: &SupabaseConfig, refresh_token: &str) -> AppResult<SyncSession> {
    let endpoint = format!("{}/auth/v1/token?grant_type=refresh_token", config.url);
    let body = serde_json::json!({ "refresh_token": refresh_token });

    let client = reqwest::Client::new();
    let resp = client
        .post(&endpoint)
        .header("apikey", &config.anon_key)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Other(format!("supabase refresh failed: {}", e)))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let detail = resp.text().await.unwrap_or_default();
        return Err(AppError::Validation(format!(
            "supabase refresh returned {}: {}",
            status, detail
        )));
    }

    let parsed: TokenResponse = resp
        .json()
        .await
        .map_err(|e| AppError::Other(format!("decode refresh response: {}", e)))?;

    let expires_at = Utc::now().timestamp().saturating_add(parsed.expires_in);

    Ok(SyncSession {
        user_id: parsed.user.id,
        email: parsed.user.email.unwrap_or_default(),
        access_token: parsed.access_token,
        refresh_token: parsed.refresh_token,
        expires_at,
    })
}

/// `POST /auth/v1/logout` — fire-and-forget. We don't surface a failure here
/// because the local session is wiped regardless; a server-side logout
/// failure just means the JWT remains valid until its natural expiry.
pub async fn logout(config: &SupabaseConfig, access_token: &str) -> AppResult<()> {
    let endpoint = format!("{}/auth/v1/logout", config.url);
    let client = reqwest::Client::new();
    let _ = client
        .post(&endpoint)
        .header("apikey", &config.anon_key)
        .header("Authorization", format!("Bearer {}", access_token))
        .send()
        .await;
    Ok(())
}

#[cfg(test)]
mod auth_tests {
    use super::*;

    #[test]
    fn supabase_config_rejects_missing_url() {
        let err = SupabaseConfig::from_settings(None, Some("anon")).unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
    }

    #[test]
    fn supabase_config_rejects_missing_anon_key() {
        let err =
            SupabaseConfig::from_settings(Some("https://x.supabase.co"), None).unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
    }

    #[test]
    fn supabase_config_strips_trailing_slash() {
        let cfg = SupabaseConfig::from_settings(
            Some("https://x.supabase.co/"),
            Some("anon-key"),
        )
        .expect("valid config");
        assert_eq!(cfg.url, "https://x.supabase.co");
        assert_eq!(cfg.anon_key, "anon-key");
    }

    #[test]
    fn supabase_config_rejects_empty_strings() {
        let err = SupabaseConfig::from_settings(Some(""), Some("anon")).unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
        let err = SupabaseConfig::from_settings(Some("https://x.co"), Some("   ")).unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
    }
}
