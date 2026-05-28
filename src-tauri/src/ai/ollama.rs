//! Thin async HTTP client for a **local** Ollama server (Vague 18).
//!
//! Ollama (https://ollama.com) runs an OpenAI-free LLM on the user's own
//! machine and exposes a tiny HTTP API on `http://localhost:11434`. We use the
//! `/api/generate` endpoint (`POST {model, prompt, system, stream:false}` ->
//! `{response}`) because the card generator is one-shot and never needs a
//! multi-turn chat history.
//!
//! Privacy + cost are the whole point: text never leaves the device and there
//! is no API bill. The trade-off is that the user must install Ollama and pull
//! a model themselves; when the daemon isn't running we surface a single,
//! actionable error rather than a raw connection-refused stack.
//!
//! This module is deliberately side-effect free (no DB, no settings) — exactly
//! like [`claude`](super::claude). The command layer resolves the URL + model
//! from settings and feeds them in.

use reqwest::Client;
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

/// Default Ollama daemon address. Matches the upstream default port.
pub const DEFAULT_OLLAMA_URL: &str = "http://localhost:11434";

/// Default model slug. `llama3.2` is small enough to run on a laptop and is
/// the model the Settings UI tells the user to `ollama pull`.
pub const DEFAULT_OLLAMA_MODEL: &str = "llama3.2";

/// Request timeout. Local generation on CPU can be slow for a full batch of
/// cards, so we mirror the generous Claude budget rather than the default 30s.
const REQUEST_TIMEOUT_SECS: u64 = 180;

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

/// Request body for `POST /api/generate`. `stream: false` collapses the token
/// stream into a single JSON object so we can `serde_json`-parse the whole
/// reply in one shot.
#[derive(Serialize)]
struct GenerateRequest<'a> {
    model: &'a str,
    prompt: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    system: Option<&'a str>,
    /// Always `false` — we don't consume the SSE token stream.
    stream: bool,
}

/// Response body from `/api/generate` with `stream:false`. Ollama returns more
/// fields (timings, context, …) but `response` is the only one we need; serde
/// ignores the rest.
#[derive(Deserialize)]
struct GenerateResponse {
    response: String,
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/// Stateless client targeting one local Ollama daemon + model.
///
/// Cheap to clone (the inner `reqwest::Client` is `Arc`-backed); commands build
/// one per request.
#[derive(Debug, Clone)]
pub struct OllamaClient {
    /// Base URL with no trailing slash, e.g. `http://localhost:11434`.
    url: String,
    model: String,
    http: Client,
}

impl OllamaClient {
    /// Build a client for `url` + `model`. A trailing slash on `url` is
    /// trimmed so [`generate_endpoint`](Self::generate_endpoint) never emits a
    /// double slash.
    pub fn new(url: String, model: String) -> AppResult<Self> {
        let http = Client::builder()
            .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS))
            .build()
            .map_err(|e| AppError::Other(format!("build Ollama HTTP client: {e}")))?;
        Ok(Self {
            url: url.trim_end_matches('/').to_string(),
            model,
            http,
        })
    }

    /// Full URL of the generate endpoint for this daemon.
    fn generate_endpoint(&self) -> String {
        format!("{}/api/generate", self.url)
    }

    /// The model identifier this client targets.
    pub fn model(&self) -> &str {
        &self.model
    }

    /// Send a single prompt (with an optional system preamble) and return the
    /// raw `response` text. The caller parses it (e.g. with
    /// [`parse_cards_response`](super::cards::parse_cards_response)).
    ///
    /// Connection failures map to a single human-readable `AppError::Other`
    /// that names the URL and reminds the user to start Ollama — a bare
    /// "connection refused" is useless in a toast.
    pub async fn generate(&self, system: Option<&str>, prompt: &str) -> AppResult<String> {
        let body = GenerateRequest {
            model: &self.model,
            prompt,
            system,
            stream: false,
        };

        let resp = self
            .http
            .post(self.generate_endpoint())
            .json(&body)
            .send()
            .await
            .map_err(|e| {
                // `is_connect()` / `is_timeout()` both mean "daemon not
                // reachable" from the user's perspective — collapse them into
                // one actionable message.
                if e.is_connect() || e.is_timeout() {
                    AppError::Other(format!(
                        "Ollama unreachable at {}. Is it running? Install it from ollama.com and run `ollama serve`.",
                        self.url
                    ))
                } else {
                    AppError::Other(format!("Ollama request failed: {e}"))
                }
            })?;

        let status = resp.status();
        if !status.is_success() {
            let raw = resp
                .text()
                .await
                .unwrap_or_else(|_| "<no body>".to_string());
            // A 404 on /api/generate almost always means the model isn't
            // pulled yet — point the user at the fix.
            if status.as_u16() == 404 {
                return Err(AppError::Other(format!(
                    "Ollama model '{}' not found. Run `ollama pull {}` first. ({})",
                    self.model, self.model, raw
                )));
            }
            return Err(AppError::Other(format!(
                "Ollama returned {}: {}",
                status.as_u16(),
                raw
            )));
        }

        let parsed: GenerateResponse = resp
            .json()
            .await
            .map_err(|e| AppError::Other(format!("invalid Ollama response: {e}")))?;
        Ok(parsed.response)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trims_trailing_slash_in_endpoint() {
        let client = OllamaClient::new(
            "http://localhost:11434/".to_string(),
            "llama3.2".to_string(),
        )
        .expect("client builds");
        assert_eq!(client.generate_endpoint(), "http://localhost:11434/api/generate");
        assert_eq!(client.model(), "llama3.2");
    }

    #[test]
    fn ollama_client_builds_correct_request() {
        // Verify the request body serialises to the exact JSON shape Ollama's
        // /api/generate expects, without making a network call.
        let body = GenerateRequest {
            model: "llama3.2",
            prompt: "Generate cards from: photosynthesis",
            system: Some("You generate flashcards."),
            stream: false,
        };
        let json = serde_json::to_value(&body).expect("serialise");
        assert_eq!(json["model"], "llama3.2");
        assert_eq!(json["prompt"], "Generate cards from: photosynthesis");
        assert_eq!(json["system"], "You generate flashcards.");
        assert_eq!(json["stream"], false);
    }

    #[test]
    fn system_is_omitted_when_none() {
        let body = GenerateRequest {
            model: "llama3.2",
            prompt: "x",
            system: None,
            stream: false,
        };
        let json = serde_json::to_value(&body).expect("serialise");
        assert!(json.get("system").is_none(), "system key must be skipped when None");
    }
}
