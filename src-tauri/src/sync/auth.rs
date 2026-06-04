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

use std::time::Duration;

use chrono::Utc;
use serde::Deserialize;

use crate::error::{AppError, AppResult};

use super::SyncSession;

/// Network timeout for every Supabase auth call. Without it a stalled
/// connection (captive portal, dropped Wi-Fi) would hang the request — and the
/// command awaiting it — indefinitely. Matches the cap used by the other HTTP
/// clients in this crate (sync, TTS, AI).
const AUTH_TIMEOUT: Duration = Duration::from_secs(30);

/// Build a timeout-bounded `reqwest` client for the auth endpoints. Construction
/// can only fail if the TLS backend can't initialise, which we surface as a
/// clear error rather than panicking.
fn build_http_client() -> AppResult<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(AUTH_TIMEOUT)
        .build()
        .map_err(|e| AppError::Other(format!("build auth http client: {}", e)))
}

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
    ///
    /// Defense-in-depth (P043): even though `save_settings` already rejects a
    /// non-`https` `supabase_url`, we re-validate the scheme here so the
    /// reqwest client can never be built against an `http://` (cleartext) or
    /// otherwise unsafe endpoint — credentials and JWTs only ever travel over
    /// TLS.
    pub fn from_settings(url: Option<&str>, anon_key: Option<&str>) -> AppResult<Self> {
        let url = url
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| {
                AppError::Validation(
                    "Sync non configurée. Renseigne l'URL Supabase dans les Paramètres.".into(),
                )
            })?;
        validate_https_url(url)?;
        let anon_key = anon_key
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| {
                AppError::Validation(
                    "Sync non configurée. Renseigne la clé anon Supabase dans les Paramètres."
                        .into(),
                )
            })?;
        Ok(SupabaseConfig {
            url: url.trim_end_matches('/').to_string(),
            anon_key: anon_key.to_string(),
        })
    }
}

/// Validate that `raw` is an absolute `https://` URL with a non-empty host.
///
/// Rejects `http`, `file`, `ws`, … schemes (which would send the anon key,
/// JWT and password in cleartext or to an unintended target) as well as
/// host-less inputs like `https:///path`. Uses `reqwest::Url` (already a
/// dependency) rather than hand-rolling a parser.
pub fn validate_https_url(raw: &str) -> AppResult<()> {
    let parsed = reqwest::Url::parse(raw)
        .map_err(|_| AppError::Validation(format!("URL Supabase invalide : « {} ».", raw)))?;
    if parsed.scheme() != "https" {
        return Err(AppError::Validation(format!(
            "L'URL Supabase doit utiliser https:// (reçu « {} »).",
            parsed.scheme()
        )));
    }
    if parsed.host_str().map(str::is_empty).unwrap_or(true) {
        return Err(AppError::Validation(
            "L'URL Supabase doit contenir un domaine valide.".into(),
        ));
    }
    Ok(())
}

/// P090 — map a Supabase auth HTTP status to a short, controlled French
/// message. The detailed body is logged backend-side and never reaches the UI,
/// so we don't leak request fragments / attacker-controlled text into a toast.
fn safe_auth_message(status: u16) -> String {
    let msg = match status {
        400 | 401 | 403 => "Identifiants Supabase invalides (e-mail ou mot de passe incorrect).",
        422 => "Requête d'authentification refusée par Supabase.",
        429 => "Trop de tentatives de connexion — réessaie plus tard.",
        s if s >= 500 => "Service Supabase indisponible — réessaie plus tard.",
        _ => "Échec de l'authentification Supabase.",
    };
    msg.to_string()
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
pub async fn login(config: &SupabaseConfig, email: &str, password: &str) -> AppResult<SyncSession> {
    if email.trim().is_empty() {
        return Err(AppError::Validation(
            "L'e-mail ne doit pas être vide.".into(),
        ));
    }
    if password.is_empty() {
        return Err(AppError::Validation(
            "Le mot de passe ne doit pas être vide.".into(),
        ));
    }

    let endpoint = format!("{}/auth/v1/token?grant_type=password", config.url);
    let body = serde_json::json!({
        "email": email,
        "password": password,
    });

    let client = build_http_client()?;
    let resp = client
        .post(&endpoint)
        .header("apikey", &config.anon_key)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Other(format!("supabase auth request failed: {}", e)))?;

    if !resp.status().is_success() {
        // P090 — Supabase auth bodies can echo request fragments / internal
        // detail; on a misconfigured (attacker-controlled) URL the body is
        // fully attacker-controlled text rendered in a toast. Log the detail
        // backend-side and surface only a short status-mapped message.
        let status = resp.status();
        let detail = resp.text().await.unwrap_or_default();
        let detail_preview: String = detail.chars().take(500).collect();
        eprintln!("[sync] supabase auth {}: {}", status, detail_preview);
        return Err(AppError::Validation(safe_auth_message(status.as_u16())));
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

    let client = build_http_client()?;
    let resp = client
        .post(&endpoint)
        .header("apikey", &config.anon_key)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Other(format!("supabase refresh failed: {}", e)))?;

    if !resp.status().is_success() {
        // P090 — same hardening as `login`: log the raw detail, surface a
        // short controlled message.
        let status = resp.status();
        let detail = resp.text().await.unwrap_or_default();
        let detail_preview: String = detail.chars().take(500).collect();
        eprintln!("[sync] supabase refresh {}: {}", status, detail_preview);
        return Err(AppError::Validation(safe_auth_message(status.as_u16())));
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
    // Best-effort: if the client can't even be built, the local session is
    // wiped by the caller regardless, so we don't surface the error.
    let Ok(client) = build_http_client() else {
        return Ok(());
    };
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
        let err = SupabaseConfig::from_settings(Some("https://x.supabase.co"), None).unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
    }

    #[test]
    fn supabase_config_strips_trailing_slash() {
        let cfg = SupabaseConfig::from_settings(Some("https://x.supabase.co/"), Some("anon-key"))
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

    #[test]
    fn supabase_config_rejects_non_https_scheme() {
        // P043: http (cleartext) and any non-https scheme must be refused even
        // if both fields are otherwise populated.
        for bad in [
            "http://x.supabase.co",
            "ftp://x.supabase.co",
            "file:///etc/passwd",
        ] {
            let err = SupabaseConfig::from_settings(Some(bad), Some("anon")).unwrap_err();
            assert!(
                matches!(err, AppError::Validation(_)),
                "expected reject for {bad}"
            );
        }
    }

    #[test]
    fn supabase_config_rejects_hostless_or_malformed_url() {
        // Note : le crate `url` « récupère » `https:///path` en host `path`, donc
        // cette entrée n'est PAS hostless. Les URLs réellement sans hôte ou
        // malformées sont rejetées soit au parse, soit par le garde host-vide de
        // `validate_https_url`.
        for bad in ["https://", "not-a-url", "https://?q=1"] {
            let err = SupabaseConfig::from_settings(Some(bad), Some("anon")).unwrap_err();
            assert!(matches!(err, AppError::Validation(_)), "doit rejeter {bad}");
        }
    }

    #[test]
    fn supabase_config_accepts_https() {
        let cfg = SupabaseConfig::from_settings(Some("https://abc.supabase.co"), Some("anon"))
            .expect("https config accepted");
        assert_eq!(cfg.url, "https://abc.supabase.co");
    }
}
