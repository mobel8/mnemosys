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
