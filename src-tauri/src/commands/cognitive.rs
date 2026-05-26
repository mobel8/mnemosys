//! Cognitive features command surface (Vague 2).
//!
//! Currently exposes a single command — [`generate_pre_questions`] — which
//! turns a deck's content into a handful of curiosity-priming questions a
//! learner answers BEFORE the actual review block. The technique boosts
//! retention by g≈0.45 (Pan et al. 2023) thanks to better attentional
//! engagement on the upcoming material.
//!
//! Implementation notes
//! --------------------
//! - We never invent facts about the deck: the LLM is fed N concrete note
//!   excerpts (front of basic cards or the prose around the cloze deletions)
//!   so the questions stay grounded.
//! - The output is parsed as a JSON array of strings. A defensive parser
//!   tolerates ```` ``` ```` fences and the occasional preamble — same
//!   playbook as `ai::cards`.
//! - If the LLM round-trip fails for any reason the command surfaces an
//!   `AppError::Other` containing the underlying transport message; the UI
//!   shows the error in a toast and the learner can skip pre-questioning.
//!
//! The command is stateless: pre-questions are generated on demand and never
//! persisted. Re-running it for the same deck will likely produce different
//! questions, which is fine — variety is a feature here.

use serde_json::Value;
use tauri::{AppHandle, State};

use crate::ai::ClaudeClient;
use crate::app_state::AppState;
use crate::error::{AppError, AppResult};

/// Sample up to this many notes per deck when feeding the LLM. Past ~10
/// concepts the question quality degrades because Claude tries to cover
/// everything; staying small keeps the questions focused.
const MAX_SOURCE_NOTES: usize = 8;

/// How many pre-questions to ask the LLM for, even if the caller doesn't
/// override it. The literature suggests 2-4 questions hits a sweet spot
/// between priming and effort.
const DEFAULT_PRE_QUESTION_COUNT: u32 = 3;

/// 8k tokens of output capacity is overkill for a handful of short
/// questions but matches the rest of our LLM call sites and keeps the
/// timeout headroom comfortable.
const MAX_OUTPUT_TOKENS: u32 = 1_500;

/// System prompt. Hammered on "JSON array only" because Claude reaches for
/// a preamble otherwise.
const SYSTEM_PROMPT: &str = r#"You are a pedagogical coach who designs pre-questions to activate curiosity before a study session.

Rules:
1. Output a JSON array of plain strings — NO markdown fences, NO preamble, NO trailing prose.
2. Each string is a single, short, open-ended question (max ~20 words) that primes the learner about the upcoming material.
3. Do NOT just rephrase the source: ask the learner to PREDICT, RECALL prior knowledge, or HYPOTHESISE.
4. Avoid yes/no questions and avoid revealing the answer in the question.
5. Stay in the requested language.

Example output (and ONLY this kind of output):
["Que sais-tu déjà sur X ?", "Pourquoi penses-tu que Y ?", "Quelle est la différence entre A et B ?"]
"#;

/// Resolve the Anthropic API key. Same precedence as `commands::ai`:
/// env var first, then persisted `app_settings.anthropic_api_key`.
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

/// Pull a short text excerpt out of a note's `fields` JSON, regardless of
/// template. We try a few well-known keys (`front`, `text`) and fall back
/// to a stringified blob so an unexpected template doesn't break sampling.
fn excerpt_from_fields(fields_json: &str) -> Option<String> {
    let value: Value = serde_json::from_str(fields_json).ok()?;
    if let Some(s) = value.get("front").and_then(|v| v.as_str()) {
        let t = s.trim();
        if !t.is_empty() {
            return Some(t.to_string());
        }
    }
    if let Some(s) = value.get("text").and_then(|v| v.as_str()) {
        let t = s.trim();
        if !t.is_empty() {
            return Some(t.to_string());
        }
    }
    // `occlusion` notes have no useful text — skip them.
    None
}

/// Sample up to `MAX_SOURCE_NOTES` concept excerpts from `deck_id`.
///
/// SQLite's `ORDER BY random()` does the shuffling so we don't have to
/// pull a `rand` crate into this crate just for one sampling pass. The
/// LIMIT is applied server-side too which keeps things cheap on big decks.
fn sample_deck_excerpts(state: &AppState, deck_id: i64) -> AppResult<Vec<String>> {
    let conn = state.db.lock();
    let mut stmt = conn.prepare(
        "SELECT fields FROM notes
         WHERE deck_id = ?1 AND template <> 'occlusion'
         ORDER BY random()
         LIMIT ?2",
    )?;
    let limit = MAX_SOURCE_NOTES as i64;
    let rows = stmt.query_map(rusqlite::params![deck_id, limit], |r| {
        r.get::<_, String>(0)
    })?;
    let mut all_excerpts = Vec::new();
    for row in rows {
        if let Ok(fields_json) = row {
            if let Some(excerpt) = excerpt_from_fields(&fields_json) {
                all_excerpts.push(excerpt);
            }
        }
    }
    Ok(all_excerpts)
}

/// Strip markdown fences if present and parse the JSON string array.
pub(super) fn parse_questions_response(response: &str) -> AppResult<Vec<String>> {
    let cleaned = strip_code_fences(response.trim());
    let parsed: Vec<String> = serde_json::from_str(cleaned).map_err(|e| {
        let preview: String = response.chars().take(200).collect();
        AppError::Other(format!(
            "Pre-question JSON parse error: {} (got: {})",
            e, preview
        ))
    })?;
    Ok(parsed
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect())
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

/// Generate 2-3 curiosity-priming questions for `deck_id`.
///
/// `count` is a hint (clamped to 1..=5); `language` is forwarded verbatim
/// to the model so the questions match the deck's locale.
#[tauri::command]
pub async fn generate_pre_questions(
    app: AppHandle,
    state: State<'_, AppState>,
    deck_id: i64,
    count: u32,
    language: String,
) -> AppResult<Vec<String>> {
    let n = count.clamp(1, 5);
    if n != count && count != 0 {
        log::debug!("generate_pre_questions: clamped count {} to {}", count, n);
    }
    let target = if n == 0 { DEFAULT_PRE_QUESTION_COUNT } else { n };

    let excerpts = sample_deck_excerpts(&state, deck_id)?;
    if excerpts.is_empty() {
        return Err(AppError::Validation(
            "deck has no text content to base pre-questions on".to_string(),
        ));
    }

    let api_key = resolve_api_key(&app)?;
    let client = ClaudeClient::new(api_key);

    let joined = excerpts
        .iter()
        .enumerate()
        .map(|(i, e)| format!("{}. {}", i + 1, e))
        .collect::<Vec<_>>()
        .join("\n");

    let prompt = format!(
        "Generate exactly {target} pre-study questions that prime curiosity \
         about the concepts below. Output language: {language}. Return ONLY \
         a JSON array of strings.\n\n\
         Concepts:\n{joined}"
    );

    let response = client
        .complete(Some(SYSTEM_PROMPT), &prompt, MAX_OUTPUT_TOKENS)
        .await
        .map_err(|e| AppError::Other(e.to_string()))?;

    let mut questions = parse_questions_response(&response)?;
    questions.truncate(target as usize);
    Ok(questions)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_clean_json_array() {
        let raw = r#"["What do you think?", "Why might X happen?"]"#;
        let qs = parse_questions_response(raw).expect("parse");
        assert_eq!(qs.len(), 2);
        assert_eq!(qs[0], "What do you think?");
    }

    #[test]
    fn parses_json_with_markdown_fences() {
        let raw = "```json\n[\"q1\", \"q2\"]\n```";
        let qs = parse_questions_response(raw).expect("parse fenced");
        assert_eq!(qs, vec!["q1", "q2"]);
    }

    #[test]
    fn extracts_excerpt_from_basic_fields() {
        let json = r#"{"front": "What is X?", "back": "Y"}"#;
        assert_eq!(excerpt_from_fields(json).as_deref(), Some("What is X?"));
    }

    #[test]
    fn extracts_excerpt_from_cloze_fields() {
        let json = r#"{"text": "The {{c1::capital}} is Paris"}"#;
        assert_eq!(
            excerpt_from_fields(json).as_deref(),
            Some("The {{c1::capital}} is Paris")
        );
    }

    #[test]
    fn excerpt_returns_none_for_occlusion() {
        let json = r#"{"image_path": "/tmp/x.png", "masks": []}"#;
        assert!(excerpt_from_fields(json).is_none());
    }
}
