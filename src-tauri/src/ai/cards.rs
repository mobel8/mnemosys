//! Prompt + JSON parser for the "generate flashcards" pipeline.
//!
//! The contract with Claude is enforced entirely through the system prompt
//! (output ONLY a JSON array) plus a defensive parser that tolerates the
//! two most common LLM transgressions — wrapping the response in
//! ```` ```json ```` fences, or sneaking a preamble before the array. We do
//! NOT use Anthropic's tool-use feature here: the schema is small, the
//! output is one-shot, and a JSON array survives prompt-cache invalidation
//! better than a tool call.

use serde::{Deserialize, Serialize};

use super::claude::{ClaudeClient, ClaudeError};

/// Template a generated card maps to in the local note model.
///
/// `Basic` => `{ "front": "...", "back": "..." }`
/// `Cloze` => `{ "text": "... {{c1::hidden}} ..." }`
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CardTemplate {
    Basic,
    Cloze,
}

/// One flashcard returned by the LLM. `fields` shape depends on `template`
/// (see [`CardTemplate`]) — we use `serde_json::Value` rather than a
/// tagged enum so the frontend can stash unexpected keys without crashing
/// the parse.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeneratedCard {
    pub template: CardTemplate,
    pub fields: serde_json::Value,
    #[serde(default)]
    pub tags: Vec<String>,
}

/// System prompt. Refined to be aggressive about the "JSON only" contract
/// because Claude's default behaviour is to add a preamble like
/// "Here are your flashcards:" which then breaks `serde_json::from_str`.
///
/// Exposed `pub(crate)` so the local-LLM path ([`commands::ai::generate_cards_local`])
/// drives Ollama with the **exact same** contract — the parser is LLM-agnostic,
/// so the prompt must be too.
pub(crate) const SYSTEM_PROMPT: &str = r#"You generate flashcards for spaced repetition learning.

Rules:
1. Output a JSON array — NO markdown fences, NO preamble, NO trailing prose.
2. Each card has exactly three keys: "template", "fields", "tags".
3. "template" is "basic" or "cloze".
4. For "basic":  fields = {"front": "question", "back": "answer"}.
5. For "cloze":  fields = {"text": "Sentence with {{c1::hidden text}} to memorize"}.
   Use {{c1::...}}, {{c2::...}} for multiple deletions in one card.
6. Each card must be atomic — one fact per card.
7. Use concise, unambiguous language; no filler ("As we can see…", "Note that…").
8. Tags are short topical labels (1-3 words, lowercase, no spaces — use hyphens).

Return ONLY the JSON array. Example output (and ONLY this kind of output):
[
  {"template":"basic","fields":{"front":"What is X?","back":"Y"},"tags":["topic-a"]},
  {"template":"cloze","fields":{"text":"The {{c1::ATP}} is the energy currency"},"tags":["bio"]}
]
"#;

/// Output cap for `complete()`. 8k tokens is enough for ~50 cards which
/// matches the practical upper bound a user would generate in one shot.
const MAX_OUTPUT_TOKENS: u32 = 8000;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Build the user-facing prompt for a card-generation request.
///
/// Pulled out (and made `pub(crate)`) so the Claude and Ollama paths emit the
/// byte-identical instruction — the only difference between the two backends
/// is the transport, never the contract.
pub(crate) fn build_card_prompt(text: &str, max_cards: u32, language: &str) -> String {
    format!(
        "Generate up to {max_cards} flashcards from the content below. \
         Output language: {language}. Return ONLY the JSON array.\n\n\
         Content:\n{text}"
    )
}

/// Generate up to `max_cards` flashcards from a raw text chunk.
///
/// `language` is a hint (`"fr"`, `"en"`, `"es"`, …) that the model uses to
/// pick the output language — it's not validated, the LLM does its best.
pub async fn generate_cards_from_text(
    client: &ClaudeClient,
    text: &str,
    max_cards: u32,
    language: &str,
) -> Result<Vec<GeneratedCard>, ClaudeError> {
    if text.trim().is_empty() {
        return Ok(Vec::new());
    }

    let prompt = build_card_prompt(text, max_cards, language);

    let response = client
        .complete(Some(SYSTEM_PROMPT), &prompt, MAX_OUTPUT_TOKENS)
        .await?;

    parse_cards_response(&response).map(|mut cards| {
        cards.truncate(max_cards as usize);
        cards
    })
}

/// Generate cards from a PDF, chunking the document so each LLM call stays
/// within a healthy context window.
///
/// One failing chunk does NOT abort the whole batch — we log and continue,
/// so a partially scannable PDF still produces cards from its readable
/// pages.
pub async fn generate_cards_from_pdf(
    client: &ClaudeClient,
    pdf_bytes: &[u8],
    max_cards: u32,
    language: &str,
) -> Result<Vec<GeneratedCard>, ClaudeError> {
    let text = super::pdf::extract_pdf_text(pdf_bytes)
        .map_err(|e| ClaudeError::InvalidResponse(format!("PDF parse: {}", e)))?;

    let chunks = super::pdf::chunk_text(&text, 4000);
    if chunks.is_empty() {
        return Ok(Vec::new());
    }

    // Aim for an even spread but always give every chunk at least 3 cards
    // — otherwise small chunks get starved on multi-page documents.
    let cards_per_chunk = (max_cards / chunks.len() as u32).max(3);

    let mut all_cards = Vec::with_capacity(max_cards as usize);
    for chunk in chunks {
        if all_cards.len() >= max_cards as usize {
            break;
        }
        match generate_cards_from_text(client, &chunk, cards_per_chunk, language).await {
            Ok(cards) => all_cards.extend(cards),
            Err(e) => eprintln!("[ai] chunk skipped: {}", e),
        }
    }

    all_cards.truncate(max_cards as usize);
    Ok(all_cards)
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/// Strip markdown code fences if present and parse the JSON array.
///
/// Pulled out so it's unit-testable without making an HTTP call. `pub(crate)`
/// because the Ollama path ([`commands::ai::generate_cards_local`]) parses its
/// raw `response` string with the same defensive logic.
pub(crate) fn parse_cards_response(response: &str) -> Result<Vec<GeneratedCard>, ClaudeError> {
    let cleaned = strip_code_fences(response.trim());

    serde_json::from_str::<Vec<GeneratedCard>>(cleaned).map_err(|e| {
        // Truncate the preview — a runaway response shouldn't make the
        // error message itself unmanageable.
        let preview: String = response.chars().take(200).collect();
        ClaudeError::InvalidResponse(format!("Card JSON parse error: {} (got: {})", e, preview))
    })
}

/// Remove ``` or ```json fences if the model wrapped the array. Idempotent.
fn strip_code_fences(s: &str) -> &str {
    let mut out = s.trim();
    // Strip an opening fence — accept ```json, ```JSON, ``` and lang tags.
    if let Some(rest) = out.strip_prefix("```") {
        // Drop the language tag up to the first newline (if any).
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
