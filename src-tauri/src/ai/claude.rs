//! Thin async HTTP client for Anthropic's Messages API.
//!
//! Scope is intentionally minimal — we only need a single `complete()` call
//! that takes a system prompt + a user message and returns the first text
//! block. Streaming, tool use, and multi-turn conversations are out of scope
//! for the Session 2 MVP (the card generator never asks follow-up questions).
//!
//! Errors are surfaced through [`ClaudeError`], which has a `From` impl into
//! [`AppError`](crate::error::AppError) so commands can use `?` freely.

use reqwest::Client;
use serde::{Deserialize, Serialize};

use crate::error::AppError;

/// Anthropic Messages endpoint. Hard-coded — we never talk to a proxy.
const CLAUDE_API_URL: &str = "https://api.anthropic.com/v1/messages";

/// Default model used by the card generator. Targets the latest Claude
/// Sonnet GA model available at the time of release. The actual ID is
/// resolved per-call so a future setting can override it without touching
/// this constant.
pub const DEFAULT_MODEL: &str = "claude-sonnet-4-5";

/// Anthropic API version pin. Bump explicitly — the response schema can
/// change between versions and we want the build to break loudly.
const ANTHROPIC_VERSION: &str = "2023-06-01";

/// Request timeout. PDF chunks can produce ~8k tokens of cards and the
/// server's TTFB grows with `max_tokens`, so we leave generous headroom.
const REQUEST_TIMEOUT_SECS: u64 = 120;

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct MessagesRequest<'a> {
    model: &'a str,
    max_tokens: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    system: Option<&'a str>,
    messages: Vec<Message<'a>>,
}

#[derive(Serialize)]
struct Message<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Deserialize)]
struct MessagesResponse {
    content: Vec<ContentBlock>,
}

#[derive(Deserialize)]
#[serde(tag = "type")]
enum ContentBlock {
    #[serde(rename = "text")]
    Text { text: String },
    /// Catch-all for non-text blocks (tool_use, image, etc.) so an
    /// unexpected block type doesn't fail the whole response parse.
    #[serde(other)]
    Other,
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/// Errors specific to the Claude transport. Kept separate from
/// [`AppError`](crate::error::AppError) so call sites can pattern-match on
/// the cause (e.g. show a "configure your key" CTA on `NoApiKey`).
//
// Messages are surfaced verbatim in the (French) UI toasts (they reach the
// frontend wrapped in `AppError::Other`), so they're written in French. The
// `NoApiKey` text keeps the literal token "Anthropic" so the frontend's
// `isApiKeyError` heuristic still routes it to the "configure your key" CTA.
#[derive(Debug, thiserror::Error)]
pub enum ClaudeError {
    #[error("Clé API Anthropic non configurée. Renseigne ANTHROPIC_API_KEY ou configure-la dans Paramètres.")]
    NoApiKey,
    #[error("Erreur HTTP : {0}")]
    Http(String),
    #[error("L'API Claude a renvoyé le statut {status} : {message}")]
    Api { status: u16, message: String },
    #[error("Réponse invalide de Claude : {0}")]
    InvalidResponse(String),
}

impl From<ClaudeError> for AppError {
    fn from(e: ClaudeError) -> Self {
        AppError::Other(e.to_string())
    }
}

/// P090 — map an upstream HTTP status to a short, controlled French message.
/// The detailed (and potentially sensitive / attacker-controlled) body is
/// logged backend-side and never reaches the UI toast.
fn safe_api_message(status: u16) -> &'static str {
    match status {
        401 | 403 => "clé API Anthropic invalide ou non autorisée",
        429 => "quota Claude dépassé — réessaie plus tard",
        s if s >= 500 => "service Claude indisponible — réessaie plus tard",
        400 => "requête refusée par Claude (contenu ou format invalide)",
        _ => "erreur de l'API Claude",
    }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/// Stateless client wrapping a configured [`reqwest::Client`].
///
/// Cheap to clone (the inner `Client` is `Arc`-backed) so commands can build
/// one per request — there's no shared state worth caching at the moment.
#[derive(Debug, Clone)]
pub struct ClaudeClient {
    api_key: String,
    model: String,
    http: Client,
}

impl ClaudeClient {
    /// Build a client using the default model.
    pub fn new(api_key: String) -> Self {
        Self::with_model(api_key, DEFAULT_MODEL.to_string())
    }

    /// Build a client targeting a specific model (e.g. for tests or future
    /// per-deck overrides).
    pub fn with_model(api_key: String, model: String) -> Self {
        Self {
            api_key,
            model,
            http: Client::builder()
                .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS))
                .build()
                .expect("reqwest client builder must succeed with default config"),
        }
    }

    /// Returns the model identifier currently used by the client.
    pub fn model(&self) -> &str {
        &self.model
    }

    /// Send a single user message and return the first text block from the
    /// assistant's reply.
    ///
    /// `system` is the system prompt (Anthropic's top-level `system` field,
    /// **not** a `role=system` message — that doesn't exist on this API).
    /// `max_tokens` caps the assistant output; pass a generous value because
    /// the API truncates silently when the budget is too small.
    pub async fn complete(
        &self,
        system: Option<&str>,
        prompt: &str,
        max_tokens: u32,
    ) -> Result<String, ClaudeError> {
        if self.api_key.trim().is_empty() {
            return Err(ClaudeError::NoApiKey);
        }

        let req = MessagesRequest {
            model: &self.model,
            max_tokens,
            system,
            messages: vec![Message {
                role: "user",
                content: prompt,
            }],
        };

        let resp = self
            .http
            .post(CLAUDE_API_URL)
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", ANTHROPIC_VERSION)
            .header("content-type", "application/json")
            .json(&req)
            .send()
            .await
            .map_err(|e| ClaudeError::Http(e.to_string()))?;

        let status = resp.status();
        if !status.is_success() {
            // P090 — never surface the upstream body verbatim to the UI: an
            // Anthropic error body can carry request fragments / org / quota
            // detail, and on an attacker-controlled endpoint it is fully
            // attacker-controlled text rendered in a toast. Read it for the
            // backend log only, then return a short status-mapped message.
            let code = status.as_u16();
            let body = resp.text().await.unwrap_or_default();
            let body_preview: String = body.chars().take(500).collect();
            eprintln!("[ai] Claude API {code}: {body_preview}");
            return Err(ClaudeError::Api {
                status: code,
                message: safe_api_message(code).to_string(),
            });
        }

        let body: MessagesResponse = resp
            .json()
            .await
            .map_err(|e| ClaudeError::InvalidResponse(e.to_string()))?;

        body.content
            .into_iter()
            .find_map(|c| match c {
                ContentBlock::Text { text } => Some(text),
                ContentBlock::Other => None,
            })
            .ok_or_else(|| {
                ClaudeError::InvalidResponse("response contained no text block".to_string())
            })
    }
}
