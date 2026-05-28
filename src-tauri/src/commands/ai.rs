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
use tauri::{AppHandle, Manager, State};

use crate::ai::cards::{build_card_prompt, parse_cards_response, SYSTEM_PROMPT};
use crate::ai::ollama::{DEFAULT_OLLAMA_MODEL, DEFAULT_OLLAMA_URL};
use crate::ai::{
    build_image_prompt, critique_cards, generate_cards_from_pdf, generate_cards_from_text,
    generate_mnemonic, CardCritique, ClaudeClient, GeneratedCard, ImageClient, OllamaClient,
};
use crate::app_state::AppState;
use crate::db::CardRepo;
use crate::error::{AppError, AppResult};

/// Sub-directory of `app_data_dir` where generated mnemonic images live.
const MNEMONIC_IMAGE_DIR: &str = "mnemonic-images";

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

/// Resolve the Ollama daemon URL + model from persisted settings, falling back
/// to the upstream defaults (`http://localhost:11434` / `llama3.2`) when a
/// field is absent or blank. Unlike [`resolve_api_key`] this never errors:
/// there's no secret to miss, and an unreachable daemon is reported later by
/// [`OllamaClient::generate`] with an actionable message.
fn resolve_ollama_config(app: &AppHandle) -> (String, String) {
    let mut url = DEFAULT_OLLAMA_URL.to_string();
    let mut model = DEFAULT_OLLAMA_MODEL.to_string();

    use tauri_plugin_store::StoreExt;
    if let Ok(store) = app.store("settings.json") {
        if let Some(value) = store.get("app_settings") {
            if let Some(u) = value
                .get("ollama_url")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
            {
                url = u.to_string();
            }
            if let Some(m) = value
                .get("ollama_model")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
            {
                model = m.to_string();
            }
        }
    }
    (url, model)
}

/// Generate up to `max_cards` flashcards from a raw text blob using a **local**
/// Ollama LLM instead of Claude (Vague 18 — privacy + zero API cost).
///
/// Reuses the exact same `SYSTEM_PROMPT`, user-prompt builder, and defensive
/// JSON parser as the Claude path — only the transport differs. The daemon URL
/// and model come from settings (`ollama_url` / `ollama_model`) with sane
/// fallbacks. If the daemon isn't running the error names the URL so the UI can
/// show « Ollama injoignable ».
#[tauri::command]
pub async fn generate_cards_local(
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

    let (url, model) = resolve_ollama_config(&app);
    let client = OllamaClient::new(url, model)?;

    let prompt = build_card_prompt(text.trim(), max_cards, &language);
    let response = client.generate(Some(SYSTEM_PROMPT), &prompt).await?;

    let mut cards = parse_cards_response(&response).map_err(|e| AppError::Other(e.to_string()))?;
    cards.truncate(max_cards as usize);
    Ok(cards)
}

/// Extract the file name (no directory) from a path. Falls back to the raw
/// path string if the OS-specific basename can't be derived (e.g. a path
/// ending in `..`). Always returns a non-empty string for a non-empty input.
fn pdf_source_filename(pdf_path: &str) -> String {
    std::path::Path::new(pdf_path)
        .file_name()
        .and_then(|n| n.to_str())
        .map(str::to_string)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| pdf_path.to_string())
}

/// Generate cards from a PDF on disk.
///
/// The path is read server-side (Tauri commands run in the Rust process)
/// so the user can hand us either a file picker path or any absolute path
/// the OS lets us open.
///
/// Vague 17 — PaperQA-style provenance: every card minted from a PDF gets a
/// `source:<filename>` tag appended (deduplicated) so the learner can trace a
/// card back to the document it came from. We use a tag rather than a new
/// `fields` key because tags already flow through `create_note`, the FTS
/// index, and the knowledge graph without any schema change. The exact page
/// number is intentionally omitted: `pdf-extract` flattens the document to a
/// single text stream, so a per-page mapping would be unreliable.
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

    let bytes = std::fs::read(&pdf_path)
        .map_err(|e| AppError::Validation(format!("cannot read PDF at {}: {}", pdf_path, e)))?;

    let api_key = resolve_api_key(&app)?;
    let client = ClaudeClient::new(api_key);
    let mut cards = generate_cards_from_pdf(&client, &bytes, max_cards, &language)
        .await
        .map_err(|e| AppError::Other(e.to_string()))?;

    // Tag every card with its source document for traceability. The tag is
    // idempotent — re-running on the same file never stacks duplicates.
    let source_tag = format!("source:{}", pdf_source_filename(&pdf_path));
    for card in &mut cards {
        if !card.tags.iter().any(|t| t == &source_tag) {
            card.tags.push(source_tag.clone());
        }
    }
    Ok(cards)
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

// ---------------------------------------------------------------------------
// Vague 13 — Multi-Agent Card Pipeline (Generator → Critic)
// ---------------------------------------------------------------------------

/// Run a "critic" pass over a batch of freshly-generated cards.
///
/// The frontend hands us the drafts it currently holds; we ask Claude to
/// score each one (factuality, clarity, atomicity, ambiguity) and propose a
/// corrected card when the score is low. Stateless — the result is meant for
/// the user to review and optionally apply before persistence, exactly like
/// the generation step it follows.
///
/// An empty `cards` list short-circuits to `Ok(vec![])` without an API call,
/// so an over-eager UI can't burn a request on nothing.
#[tauri::command]
pub async fn critique_generated_cards(
    app: AppHandle,
    cards: Vec<GeneratedCard>,
) -> AppResult<Vec<CardCritique>> {
    if cards.is_empty() {
        return Ok(Vec::new());
    }

    let api_key = resolve_api_key(&app)?;
    let client = ClaudeClient::new(api_key);
    critique_cards(&client, &cards)
        .await
        .map_err(|e| AppError::Other(e.to_string()))
}

// ---------------------------------------------------------------------------
// Vague 13 — Mnemonic Helper
// ---------------------------------------------------------------------------

/// Pull a `(front, back)` pair out of a note's `fields` JSON.
///
/// `basic` / `basic_reverse` map to `{ front, back }`; `cloze` maps to
/// `{ text }` (returned as `(text, "")`). Any other template (occlusion,
/// sentence, …) yields an error — there's no meaningful prompt/answer pair to
/// build a mnemonic from. Mirrors the extraction logic in `commands::podcast`.
fn front_back_from_fields(fields: &serde_json::Value) -> AppResult<(String, String)> {
    if let (Some(front), Some(back)) = (
        fields.get("front").and_then(|v| v.as_str()),
        fields.get("back").and_then(|v| v.as_str()),
    ) {
        let f = front.trim();
        if !f.is_empty() {
            return Ok((f.to_string(), back.trim().to_string()));
        }
    }
    if let Some(text) = fields.get("text").and_then(|v| v.as_str()) {
        let t = text.trim();
        if !t.is_empty() {
            return Ok((t.to_string(), String::new()));
        }
    }
    Err(AppError::Validation(
        "this card has no front/back text to build a mnemonic from".to_string(),
    ))
}

/// Generate a vivid mnemonic aid for one card the learner keeps forgetting.
///
/// Loads the card + its parent note from the DB, extracts the prompt/answer
/// pair, and asks Claude for a memorable association. `language` is forwarded
/// verbatim. The command does NOT gate on `lapses` — the UI decides when to
/// surface the affordance (typically `lapses >= 3`); calling it on any card
/// is harmless and always returns a usable aid.
#[tauri::command]
pub async fn generate_card_mnemonic(
    app: AppHandle,
    state: State<'_, AppState>,
    card_id: i64,
    language: String,
) -> AppResult<String> {
    // Lock + load are cheap and synchronous; do them before the async API
    // call so we never hold the DB mutex across an `.await`.
    let (front, back) = {
        let conn = state.db.lock();
        let with_note = CardRepo::new(&conn).get_with_note(card_id)?;
        front_back_from_fields(&with_note.note.fields)?
    };

    let api_key = resolve_api_key(&app)?;
    let client = ClaudeClient::new(api_key);
    generate_mnemonic(&client, &front, &back, &language)
        .await
        .map_err(|e| AppError::Other(e.to_string()))
}

// ---------------------------------------------------------------------------
// Vague 22 — Mnemonic image (DALL·E)
// ---------------------------------------------------------------------------

/// Resolve the **OpenAI** API key (distinct from [`resolve_api_key`], which
/// resolves the Anthropic one). Env var wins, then the persisted settings.
/// Mirrors the resolution used by the TTS commands so a single OpenAI key
/// powers both speech and image generation.
fn resolve_openai_key(app: &AppHandle) -> AppResult<String> {
    if let Ok(key) = std::env::var("OPENAI_API_KEY") {
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
            .get("openai_api_key")
            .and_then(|v| v.as_str())
            .map(str::trim)
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

/// Resolve `<app_data_dir>/mnemonic-images`, creating it on demand.
fn mnemonic_image_dir(app: &AppHandle) -> AppResult<std::path::PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Other(format!("app_data_dir unavailable: {e}")))?
        .join(MNEMONIC_IMAGE_DIR);
    if !dir.exists() {
        std::fs::create_dir_all(&dir)?;
    }
    Ok(dir)
}

/// Hex SHA-256 of the prompt — a stable, collision-free file name so the same
/// card+prompt reuses one PNG instead of re-billing DALL·E on every click.
fn image_filename(prompt: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(prompt.as_bytes());
    format!("{:x}.png", hasher.finalize())
}

/// Generate (or reuse) a DALL·E mnemonic image for one card the learner keeps
/// forgetting (Vague 22 — dual-coding companion to the text mnemonic of V13).
///
/// Loads the card + parent note, builds an absurd-scene prompt from the
/// front/back, and writes the PNG under `<app_data_dir>/mnemonic-images/`.
/// Returns the absolute path; the frontend feeds it through `convertFileSrc()`.
/// Idempotent: a prompt already on disk skips the API call entirely. Fails
/// cleanly with an actionable error when no OpenAI key is configured.
#[tauri::command]
pub async fn generate_card_mnemonic_image(
    app: AppHandle,
    state: State<'_, AppState>,
    card_id: i64,
) -> AppResult<String> {
    // Lock + load synchronously, before the async API call, so the DB mutex is
    // never held across an `.await` (same discipline as generate_card_mnemonic).
    let (front, back) = {
        let conn = state.db.lock();
        let with_note = CardRepo::new(&conn).get_with_note(card_id)?;
        front_back_from_fields(&with_note.note.fields)?
    };

    let prompt = build_image_prompt(&front, &back);

    // Reuse a previously generated image for the identical prompt.
    let dir = mnemonic_image_dir(&app)?;
    let target = dir.join(image_filename(&prompt));
    if target.is_file() {
        return Ok(target.to_string_lossy().into_owned());
    }

    let api_key = resolve_openai_key(&app)?;
    let client = ImageClient::new(api_key);
    let png = client
        .generate(&prompt)
        .await
        .map_err(|e| AppError::Other(e.to_string()))?;

    std::fs::write(&target, &png)?;
    Ok(target.to_string_lossy().into_owned())
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

    #[test]
    fn front_back_from_basic_fields() {
        let fields = serde_json::json!({"front": "Capitale ?", "back": "Paris"});
        let (front, back) = front_back_from_fields(&fields).expect("basic must parse");
        assert_eq!(front, "Capitale ?");
        assert_eq!(back, "Paris");
    }

    #[test]
    fn front_back_from_cloze_fields_has_empty_back() {
        let fields = serde_json::json!({"text": "La {{c1::capitale}} est Paris"});
        let (front, back) = front_back_from_fields(&fields).expect("cloze must parse");
        assert_eq!(front, "La {{c1::capitale}} est Paris");
        assert!(back.is_empty());
    }

    #[test]
    fn front_back_rejects_occlusion() {
        let fields = serde_json::json!({"image_path": "/tmp/x.png", "masks": []});
        assert!(front_back_from_fields(&fields).is_err());
    }

    #[test]
    fn mnemonic_image_prompt_from_card() {
        // The command builds the DALL·E prompt from a card's extracted
        // front/back; this exercises that wiring without any network call.
        let fields = serde_json::json!({"front": "Capitale du Japon ?", "back": "Tokyo"});
        let (front, back) = front_back_from_fields(&fields).expect("basic must parse");
        let prompt = build_image_prompt(&front, &back);
        assert!(prompt.contains("Capitale du Japon ?"));
        assert!(prompt.contains("Tokyo"));
        assert!(prompt.contains("mnémotechnique"));
        // No-text guard so DALL·E doesn't render the answer as caption.
        assert!(prompt.contains("sans aucun texte"));
    }

    #[test]
    fn image_filename_is_stable_and_png() {
        let a = image_filename("prompt A");
        let b = image_filename("prompt A");
        let c = image_filename("prompt B");
        assert_eq!(a, b, "same prompt -> same filename (cache reuse)");
        assert_ne!(a, c, "different prompt -> different filename");
        assert!(a.ends_with(".png"));
    }

    #[test]
    fn pdf_source_filename_strips_directory() {
        assert_eq!(
            pdf_source_filename("/home/u/docs/biology chapter 3.pdf"),
            "biology chapter 3.pdf"
        );
        assert_eq!(pdf_source_filename("notes.pdf"), "notes.pdf");
    }

    #[test]
    fn pdf_source_filename_falls_back_for_pathological_path() {
        // A path with no extractable basename falls back to the raw string
        // (never empty) so the resulting tag is always meaningful.
        let raw = "..";
        assert_eq!(pdf_source_filename(raw), raw);
    }
}
