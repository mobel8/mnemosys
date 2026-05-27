//! Tauri command surface for Whisper voice transcription (Vague 8).
//!
//! Takes a base64-encoded audio blob (captured by the frontend via
//! `MediaRecorder`), decodes it, and forwards the bytes to OpenAI's Whisper
//! API. Returns the transcribed text as a plain string so the caller can
//! pipe it straight into the type-the-answer fuzzy scorer.
//!
//! API key resolution mirrors [`crate::commands::tts`]: env var first, then
//! the persisted `openai_api_key` field on [`AppSettings`].

use base64::Engine;
use tauri::AppHandle;

use crate::error::{AppError, AppResult};
use crate::tts::whisper::MAX_AUDIO_BYTES;
use crate::tts::WhisperClient;

fn resolve_api_key(app: &AppHandle) -> AppResult<String> {
    if let Ok(key) = std::env::var("OPENAI_API_KEY") {
        if !key.is_empty() {
            return Ok(key);
        }
    }

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

/// Decode + transcribe a single voice answer.
///
/// `audio_base64` is the raw audio payload (e.g. an `audio/webm` recording)
/// encoded with standard base64 (NOT a data URL — the frontend strips the
/// `data:audio/webm;base64,` prefix before sending).
#[tauri::command]
pub async fn transcribe_voice_answer(
    app: AppHandle,
    audio_base64: String,
    mime_type: String,
    language: Option<String>,
) -> AppResult<String> {
    if audio_base64.trim().is_empty() {
        return Err(AppError::Validation(
            "audio_base64 must not be empty".to_string(),
        ));
    }
    if mime_type.trim().is_empty() {
        return Err(AppError::Validation(
            "mime_type must not be empty".to_string(),
        ));
    }

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(audio_base64.as_bytes())
        .map_err(|e| AppError::Validation(format!("invalid base64 payload: {e}")))?;

    if bytes.is_empty() {
        return Err(AppError::Validation("decoded audio is empty".to_string()));
    }
    if bytes.len() > MAX_AUDIO_BYTES {
        return Err(AppError::Validation(format!(
            "audio too large: {} bytes (limit: {} bytes)",
            bytes.len(),
            MAX_AUDIO_BYTES
        )));
    }

    let api_key = resolve_api_key(&app)?;
    let client = WhisperClient::new(api_key);
    let text = client
        .transcribe(bytes, &mime_type, language.as_deref())
        .await
        .map_err(|e| AppError::Other(e.to_string()))?;

    Ok(text.trim().to_string())
}
