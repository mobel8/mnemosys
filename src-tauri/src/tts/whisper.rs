//! OpenAI Whisper transcription client (Vague 8 — Whisper Mode Review).
//!
//! Wraps a single endpoint (`POST /v1/audio/transcriptions`) and returns the
//! transcribed text. Multipart upload because the API requires the audio
//! payload as a file part, not raw JSON.
//!
//! Lives next to [`super::openai`] so the existing OpenAI key resolution
//! pattern is reused unchanged at the command layer.

use reqwest::multipart::{Form, Part};
use reqwest::Client;
use serde::Deserialize;

/// OpenAI audio transcription endpoint.
const WHISPER_URL: &str = "https://api.openai.com/v1/audio/transcriptions";

/// Whisper-1 is the only model exposed for transcription as of 2026. Stable
/// pricing, broad language support.
const WHISPER_MODEL: &str = "whisper-1";

/// OpenAI multipart upload limit. Mirrors the documented 25 MB cap so we
/// fail loudly client-side rather than wait for a 4xx.
pub const MAX_AUDIO_BYTES: usize = 25 * 1024 * 1024;

/// Errors raised by [`WhisperClient::transcribe`]. Kept narrow on purpose —
/// the command layer maps them into [`crate::error::AppError`] strings.
#[derive(Debug, thiserror::Error)]
pub enum WhisperError {
    #[error("OpenAI API key not configured. Set OPENAI_API_KEY env var or configure in Settings.")]
    NoApiKey,

    #[error("Audio file too large: {0} bytes (limit: 25 MB)")]
    TooLarge(usize),

    #[error("HTTP error: {0}")]
    Http(String),

    #[error("Whisper API {status}: {message}")]
    Api { status: u16, message: String },

    #[error("Invalid response from Whisper: {0}")]
    InvalidResponse(String),
}

#[derive(Deserialize)]
struct WhisperResponse {
    text: String,
}

/// Thin client wrapping the configured `reqwest::Client`. Cheap to construct.
pub struct WhisperClient {
    api_key: String,
    http: Client,
}

impl WhisperClient {
    /// Build a Whisper client. Does **not** validate the key — the first
    /// transcription call surfaces the error so construction stays infallible.
    pub fn new(api_key: String) -> Self {
        Self {
            api_key,
            http: Client::builder()
                .timeout(std::time::Duration::from_secs(120))
                .build()
                .expect("reqwest client builder must succeed"),
        }
    }

    /// Transcribe `audio_bytes` using Whisper-1.
    ///
    /// `mime_type` is forwarded verbatim as the multipart `Content-Type`
    /// (e.g. `audio/webm`, `audio/wav`). `language` is an optional ISO-639-1
    /// hint that improves accuracy when the speaker is non-English; passing
    /// `None` makes Whisper auto-detect.
    pub async fn transcribe(
        &self,
        audio_bytes: Vec<u8>,
        mime_type: &str,
        language: Option<&str>,
    ) -> Result<String, WhisperError> {
        if self.api_key.is_empty() {
            return Err(WhisperError::NoApiKey);
        }
        if audio_bytes.len() > MAX_AUDIO_BYTES {
            return Err(WhisperError::TooLarge(audio_bytes.len()));
        }

        // Derive a plausible filename from the MIME so the API picks the
        // right decoder. The filename itself doesn't matter to Whisper, but
        // the extension is part of how the multipart layer guesses things.
        let filename = match mime_type {
            "audio/wav" | "audio/x-wav" => "recording.wav",
            "audio/mp3" | "audio/mpeg" => "recording.mp3",
            "audio/mp4" | "audio/m4a" => "recording.m4a",
            "audio/ogg" => "recording.ogg",
            _ => "recording.webm",
        };

        let mut part = Part::bytes(audio_bytes).file_name(filename.to_string());
        part = part
            .mime_str(mime_type)
            .map_err(|e| WhisperError::Http(format!("invalid mime: {e}")))?;

        let mut form = Form::new()
            .text("model", WHISPER_MODEL)
            .text("response_format", "json")
            .part("file", part);
        if let Some(lang) = language {
            if !lang.is_empty() {
                form = form.text("language", lang.to_string());
            }
        }

        let resp = self
            .http
            .post(WHISPER_URL)
            .header("authorization", format!("Bearer {}", self.api_key))
            .multipart(form)
            .send()
            .await
            .map_err(|e| WhisperError::Http(e.to_string()))?;

        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(WhisperError::Api {
                status: status.as_u16(),
                message: body,
            });
        }

        let parsed: WhisperResponse = resp
            .json()
            .await
            .map_err(|e| WhisperError::InvalidResponse(e.to_string()))?;
        Ok(parsed.text)
    }
}
