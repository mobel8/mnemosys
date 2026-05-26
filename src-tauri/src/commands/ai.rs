//! Tauri command surface for the AI card generator (Vague A2.1).
//!
//! Two commands:
//! - [`generate_cards_text`] — generate cards from a raw text blob
//! - [`generate_cards_pdf`]  — generate cards from a PDF on disk
//!
//! Both return `Vec<GeneratedCard>` straight to the frontend, which is then
//! responsible for letting the user review/edit and persist them via the
//! existing `create_note` command. Keeping the generator stateless makes
//! it trivial to retry / regenerate without DB cleanup.
//!
//! API key resolution
//! ------------------
//! 1. `ANTHROPIC_API_KEY` env var (preferred for dev / CI).
//! 2. Falls back to the `anthropic_api_key` field of [`AppSettings`] stored
//!    via `tauri-plugin-store`.
//! 3. If neither is set, returns a validation error suitable for the UI
//!    to surface as a "configure your key" hint.

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::ai::{generate_cards_from_pdf, generate_cards_from_text, ClaudeClient, GeneratedCard};
use crate::error::{AppError, AppResult};

/// Resolve the Anthropic API key. Env var wins; falls back to the persisted
/// app settings. Returns a validation error with actionable copy if both
/// sources come up empty.
fn resolve_api_key(app: &AppHandle) -> AppResult<String> {
    if let Ok(key) = std::env::var("ANTHROPIC_API_KEY") {
        if !key.trim().is_empty() {
            return Ok(key);
        }
    }

    use tauri_plugin_store::StoreExt;
    let store = app
        .store("settings.json")
        .map_err(|e| AppError::Other(format!("open settings store: {e}")))?;
    if let Some(value) = store.get("app_settings") {
        if let Some(key) = value
            .get("anthropic_api_key")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            return Ok(key.to_string());
        }
    }

    Err(AppError::Validation(
        "Anthropic API key not configured. Set ANTHROPIC_API_KEY env var or configure it in Settings."
            .to_string(),
    ))
}

/// Generate up to `max_cards` flashcards from a raw text blob.
///
/// `language` is a hint (`"fr"`, `"en"`, …) passed verbatim to the model
/// so it picks the output language. No server-side validation — anything
/// the LLM understands is fine.
#[tauri::command]
pub async fn generate_cards_text(
    app: AppHandle,
    text: String,
    max_cards: u32,
    language: String,
) -> AppResult<Vec<GeneratedCard>> {
    if text.trim().is_empty() {
        return Err(AppError::Validation("text must not be empty".to_string()));
    }
    if max_cards == 0 {
        return Err(AppError::Validation(
            "max_cards must be at least 1".to_string(),
        ));
    }

    let api_key = resolve_api_key(&app)?;
    let client = ClaudeClient::new(api_key);
    generate_cards_from_text(&client, &text, max_cards, &language)
        .await
        .map_err(|e| AppError::Other(e.to_string()))
}

/// Generate cards from a PDF on disk.
///
/// The path is read server-side (Tauri commands run in the Rust process)
/// so the user can hand us either a file picker path or any absolute path
/// the OS lets us open.
#[tauri::command]
pub async fn generate_cards_pdf(
    app: AppHandle,
    pdf_path: String,
    max_cards: u32,
    language: String,
) -> AppResult<Vec<GeneratedCard>> {
    if max_cards == 0 {
        return Err(AppError::Validation(
            "max_cards must be at least 1".to_string(),
        ));
    }

    let bytes = std::fs::read(&pdf_path).map_err(|e| {
        AppError::Validation(format!("cannot read PDF at {}: {}", pdf_path, e))
    })?;

    let api_key = resolve_api_key(&app)?;
    let client = ClaudeClient::new(api_key);
    generate_cards_from_pdf(&client, &bytes, max_cards, &language)
        .await
        .map_err(|e| AppError::Other(e.to_string()))
}

// ---------------------------------------------------------------------------
// Vague 5 — Card elaboration (Why? + Example)
// ---------------------------------------------------------------------------

/// One elaboration enrichment for a card: a short « why this is correct »
/// rationale (elaborative interrogation — Bisra meta g=0.55) plus 1-2
/// concrete examples (concrete examples — Micallef d=0.30). Either field
/// may be an empty string if Claude couldn't produce a useful payload.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CardElaborationDTO {
    /// One-sentence elaborative-interrogation rationale.
    pub why: String,
    /// 1-2 concrete worked examples concatenated with `\n` separators.
    pub example: String,
}

/// System prompt for the elaboration generator. Same JSON-only discipline
/// as the main card generator so we can parse the response with `serde_json`.
const ELABORATION_SYSTEM_PROMPT: &str = r#"You enrich a flashcard with two pedagogical augmentations:
1. "why"    — one short sentence explaining WHY the answer is correct (elaborative interrogation).
2. "example" — one or two short, concrete examples that illustrate the concept (concrete examples).

Rules:
1. Output a SINGLE JSON object — NO markdown fences, NO preamble, NO trailing prose.
2. Keys: "why" (string), "example" (string). Both required, both non-null.
3. "why" stays under ~25 words and avoids restating the answer verbatim.
4. "example" is short: ~1-2 sentences total, with each example on its own line if there are two.
5. Stay in the requested language.
6. NEVER invent facts you cannot ground in the supplied card content.

Example output (and ONLY this kind of output):
{"why":"Because X causes Y through Z.","example":"Ex 1: ...\nEx 2: ..."}
"#;

const ELABORATION_MAX_OUTPUT_TOKENS: u32 = 600;

/// Strip markdown fences if present and parse a single elaboration object.
fn parse_elaboration_response(response: &str) -> AppResult<CardElaborationDTO> {
    let cleaned = strip_code_fences(response.trim());
    serde_json::from_str::<CardElaborationDTO>(cleaned).map_err(|e| {
        let preview: String = response.chars().take(200).collect();
        AppError::Other(format!(
            "Elaboration JSON parse error: {} (got: {})",
            e, preview
        ))
    })
}

fn strip_code_fences(s: &str) -> &str {
    let mut out = s.trim();
    if let Some(rest) = out.strip_prefix("```") {
        let rest = match rest.find('\n') {
            Some(nl) => &rest[nl + 1..],
            None => rest,
        };
        out = rest.trim_end();
    }
    if let Some(stripped) = out.strip_suffix("```") {
        out = stripped.trim_end();
    }
    out.trim()
}

/// Generate a `{ why, example }` elaboration for a single card.
///
/// `card_text` is the prompt+answer concatenation the UI has already
/// computed (basic: « front / back »; cloze: the full text). Stateless —
/// the result is meant to be merged into the note's `fields` JSON by the
/// caller before persistence.
#[tauri::command]
pub async fn generate_card_elaboration(
    app: AppHandle,
    card_text: String,
    language: String,
) -> AppResult<CardElaborationDTO> {
    let trimmed = card_text.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation(
            "card_text must not be empty".to_string(),
        ));
    }

    let api_key = resolve_api_key(&app)?;
    let client = ClaudeClient::new(api_key);

    let prompt = format!(
        "Enrich the following flashcard. Output language: {language}. \
         Return ONLY the JSON object.\n\n\
         Card:\n{trimmed}"
    );

    let response = client
        .complete(
            Some(ELABORATION_SYSTEM_PROMPT),
            &prompt,
            ELABORATION_MAX_OUTPUT_TOKENS,
        )
        .await
        .map_err(|e| AppError::Other(e.to_string()))?;

    parse_elaboration_response(&response)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_clean_elaboration_json() {
        let raw = r#"{"why":"Because A causes B.","example":"Ex: water boils at 100C."}"#;
        let dto = parse_elaboration_response(raw).expect("parse");
        assert_eq!(dto.why, "Because A causes B.");
        assert!(dto.example.contains("100C"));
    }

    #[test]
    fn parses_elaboration_with_fences() {
        let raw = "```json\n{\"why\":\"x\",\"example\":\"y\"}\n```";
        let dto = parse_elaboration_response(raw).expect("parse fenced");
        assert_eq!(dto.why, "x");
        assert_eq!(dto.example, "y");
    }

    #[test]
    fn elaboration_rejects_malformed_payload() {
        let raw = "not json at all";
        assert!(parse_elaboration_response(raw).is_err());
    }
}
