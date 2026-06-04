//! OpenAI text-to-speech HTTP client.
//!
//! Wraps a single endpoint (`POST /v1/audio/speech`) and returns raw MP3
//! bytes. The caller (commands layer) decides what to do with them —
//! typically write to [`super::cache::TTSCache`].
//!
//! Model choice: `gpt-4o-mini-tts` is the cheapest stable voice as of
//! 2026, and quality is identical to the larger tier for short phrases
//! (flashcard answers are rarely longer than a sentence).

use reqwest::Client;
use serde::Serialize;

/// OpenAI speech synthesis endpoint.
const OPENAI_TTS_URL: &str = "https://api.openai.com/v1/audio/speech";

/// Default model. Low-cost, stable, MP3 output.
///
/// P118 — `pub` so the command layer can pass the exact model that produced the
/// audio into [`super::cache::TTSCache::new_for_model`], keeping the cache key
/// aligned with the real model (a single source of truth for invalidation).
pub const DEFAULT_MODEL: &str = "gpt-4o-mini-tts";

/// All voices currently offered by OpenAI TTS (Dec 2025).
///
/// Serialised lowercase to match the JSON payload OpenAI expects.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Voice {
    Alloy,
    Echo,
    Fable,
    Onyx,
    Nova,
    Shimmer,
    Coral,
    Sage,
}

impl Voice {
    /// String form sent in the API request and used as part of the cache key.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Alloy => "alloy",
            Self::Echo => "echo",
            Self::Fable => "fable",
            Self::Onyx => "onyx",
            Self::Nova => "nova",
            Self::Shimmer => "shimmer",
            Self::Coral => "coral",
            Self::Sage => "sage",
        }
    }
}

/// Errors raised by [`OpenAIClient::synthesize`].
///
/// Network and non-2xx HTTP statuses are kept distinct so the UI can decide
/// whether to retry (transient `Http`) or surface the response body
/// verbatim (`Api`).
#[derive(Debug, thiserror::Error)]
pub enum TTSError {
    #[error("OpenAI API key not configured. Set OPENAI_API_KEY env var or configure in Settings.")]
    NoApiKey,

    #[error("HTTP error: {0}")]
    Http(String),

    #[error("API error {status}: {message}")]
    Api { status: u16, message: String },

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

/// On-the-wire JSON payload. Field names match OpenAI's spec verbatim;
/// reordering or renaming any of these will silently break the call.
#[derive(Serialize)]
struct TTSRequest<'a> {
    model: &'a str,
    input: &'a str,
    voice: &'a str,
    response_format: &'a str,
    speed: f32,
}

/// Thin OpenAI TTS client. Cheap to construct; `reqwest::Client` holds a
/// connection pool so reusing the instance is preferable.
pub struct OpenAIClient {
    api_key: String,
    http: Client,
}

impl OpenAIClient {
    /// Create a new client. Does **not** validate the API key — that only
    /// happens on the first [`Self::synthesize`] call so the constructor
    /// stays infallible.
    pub fn new(api_key: String) -> Self {
        Self {
            api_key,
            http: Client::builder()
                .timeout(std::time::Duration::from_secs(60))
                .build()
                .expect("reqwest client builder cannot fail with these options"),
        }
    }

    /// Synthesise `text` and return the raw MP3 bytes.
    ///
    /// `speed` is clamped to OpenAI's documented range `[0.25, 4.0]` so a
    /// malformed slider in the UI can never produce a 4xx.
    pub async fn synthesize(
        &self,
        text: &str,
        voice: Voice,
        speed: f32,
    ) -> Result<Vec<u8>, TTSError> {
        if self.api_key.is_empty() {
            return Err(TTSError::NoApiKey);
        }

        let req = TTSRequest {
            model: DEFAULT_MODEL,
            input: text,
            voice: voice.as_str(),
            response_format: "mp3",
            speed: speed.clamp(0.25, 4.0),
        };

        let resp = self
            .http
            .post(OPENAI_TTS_URL)
            .header("authorization", format!("Bearer {}", self.api_key))
            .header("content-type", "application/json")
            .json(&req)
            .send()
            .await
            .map_err(|e| TTSError::Http(e.to_string()))?;

        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(TTSError::Api {
                status: status.as_u16(),
                message: body,
            });
        }

        let bytes = resp
            .bytes()
            .await
            .map_err(|e| TTSError::Http(e.to_string()))?;
        Ok(bytes.to_vec())
    }
}
