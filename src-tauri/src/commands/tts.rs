//! Tauri command surface for the TTS service (Vague A2.2).
//!
//! Three commands:
//! - [`synthesize_audio`]  — cache-or-fetch MP3 for `(text, voice, speed)`
//! - [`clear_tts_cache`]   — wipe every cached `*.mp3`
//! - [`get_tts_cache_size`]— sum of all file sizes in bytes
//!
//! All MP3s live under `<app_cache_dir>/tts/`. The path returned by
//! [`synthesize_audio`] is absolute and ready to be passed to
//! `convertFileSrc()` on the frontend.
//!
//! API key resolution
//! ------------------
//! 1. `OPENAI_API_KEY` env var (preferred for dev / CI).
//! 2. Falls back to the `openai_api_key` field of [`AppSettings`] stored
//!    via `tauri-plugin-store`.
//! 3. If neither is set, returns a validation error suitable for the UI
//!    to surface as a "configure your key" hint.

use std::path::PathBuf;

use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};
use crate::tts::{OpenAIClient, TTSCache, Voice};

/// Frontend-visible result of [`synthesize_audio`].
#[derive(Debug, serde::Serialize)]
pub struct TTSResult {
    /// Absolute path to the MP3 file on disk. Feed into `convertFileSrc()`.
    pub path: String,
    /// `true` if the file already existed in cache (no API call made).
    pub cached: bool,
    /// Size of the MP3 in bytes (informational; useful for stats UI).
    pub size_bytes: usize,
}

/// Resolve `<app_cache_dir>/tts/`, creating the parent dir on demand.
fn cache_dir(app: &AppHandle) -> AppResult<PathBuf> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| AppError::Other(format!("resolve app_cache_dir: {e}")))?
        .join("tts");
    Ok(dir)
}

/// Map the public-facing voice string to the typed enum. Unknown values
/// surface as `AppError::Validation` so the UI can show a precise message.
fn parse_voice(voice: &str) -> AppResult<Voice> {
    Ok(match voice {
        "alloy" => Voice::Alloy,
        "echo" => Voice::Echo,
        "fable" => Voice::Fable,
        "onyx" => Voice::Onyx,
        "nova" => Voice::Nova,
        "shimmer" => Voice::Shimmer,
        "coral" => Voice::Coral,
        "sage" => Voice::Sage,
        other => {
            return Err(AppError::Validation(format!(
                "Unknown voice: {other}. Supported: alloy, echo, fable, onyx, nova, shimmer, coral, sage"
            )));
        }
    })
}

/// Resolve the OpenAI API key. Env var wins; falls back to the persisted
/// app settings. Returns a validation error with actionable copy if both
/// sources come up empty.
fn resolve_api_key(app: &AppHandle) -> AppResult<String> {
    if let Ok(key) = std::env::var("OPENAI_API_KEY") {
        if !key.is_empty() {
            return Ok(key);
        }
    }

    // Fall back to the AppSettings blob (`tauri-plugin-store`). We don't
    // hold a typed handle here — pulling settings inline keeps the TTS
    // module decoupled from the rest of the settings code.
    use tauri_plugin_store::StoreExt;
    let store = app
        .store("settings.json")
        .map_err(|e| AppError::Other(format!("open settings store: {e}")))?;
    if let Some(value) = store.get("app_settings") {
        if let Some(key) = value
            .get("openai_api_key")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
        {
            return Ok(key.to_string());
        }
    }

    Err(AppError::Validation(
        "OpenAI API key not configured. Set OPENAI_API_KEY env var or configure it in Settings."
            .to_string(),
    ))
}

/// Synthesise (or cache-hit) speech for `text` with `voice` and optional `speed`.
///
/// Returns a [`TTSResult`] carrying the on-disk MP3 path. The frontend
/// should pass `path` through `convertFileSrc()` before assigning it to
/// `<audio src=...>`.
#[tauri::command]
pub async fn synthesize_audio(
    app: AppHandle,
    text: String,
    voice: String,
    speed: Option<f32>,
) -> AppResult<TTSResult> {
    if text.trim().is_empty() {
        return Err(AppError::Validation("text must not be empty".to_string()));
    }

    let voice_enum = parse_voice(&voice)?;
    let speed = speed.unwrap_or(1.0);

    let cache = TTSCache::new(cache_dir(&app)?)?;

    // Fast path: already on disk.
    if cache.exists(&text, voice.as_str(), speed) {
        let path = cache.path_for(&text, voice.as_str(), speed);
        let size = std::fs::metadata(&path)
            .map(|m| m.len() as usize)
            .unwrap_or(0);
        return Ok(TTSResult {
            path: path.to_string_lossy().into_owned(),
            cached: true,
            size_bytes: size,
        });
    }

    // Cache miss — call OpenAI.
    let api_key = resolve_api_key(&app)?;
    let client = OpenAIClient::new(api_key);
    let audio = client
        .synthesize(&text, voice_enum, speed)
        .await
        .map_err(|e| AppError::Other(e.to_string()))?;

    let path = cache.write(&text, voice.as_str(), speed, &audio)?;

    Ok(TTSResult {
        path: path.to_string_lossy().into_owned(),
        cached: false,
        size_bytes: audio.len(),
    })
}

/// Wipe every `*.mp3` file from the cache directory.
///
/// No-op (returns `Ok(())`) if the directory does not yet exist — that
/// matches the "first launch, nothing to clear" scenario.
#[tauri::command]
pub fn clear_tts_cache(app: AppHandle) -> AppResult<()> {
    let dir = cache_dir(&app)?;
    if !dir.exists() {
        return Ok(());
    }
    let cache = TTSCache::new(dir)?;
    cache.clear()?;
    Ok(())
}

/// Total bytes occupied by the TTS cache directory. Used by Settings UI.
#[tauri::command]
pub fn get_tts_cache_size(app: AppHandle) -> AppResult<u64> {
    let dir = cache_dir(&app)?;
    if !dir.exists() {
        return Ok(0);
    }
    let mut total: u64 = 0;
    for entry in std::fs::read_dir(&dir)? {
        let entry = entry?;
        if let Ok(meta) = entry.metadata() {
            if meta.is_file() {
                total = total.saturating_add(meta.len());
            }
        }
    }
    Ok(total)
}
