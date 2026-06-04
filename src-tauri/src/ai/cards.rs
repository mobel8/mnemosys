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

    // P075 — spread the budget across chunks WITHOUT overshooting `max_cards`.
    // The old `(max/chunks).max(3)` requested up to `3 * chunks` cards (e.g. 12
    // for max=5 over 4 chunks), front-loading the first pages and burning extra
    // API tokens on cards we'd only truncate away. Instead we track the budget
    // remaining and ask each chunk for `remaining / chunks_left` (rounded up,
    // floored at 1), so coverage stays even and the total never exceeds the cap.
    let chunk_count = chunks.len();
    let mut all_cards = Vec::with_capacity(max_cards as usize);
    for (i, chunk) in chunks.into_iter().enumerate() {
        let remaining = (max_cards as usize).saturating_sub(all_cards.len());
        if remaining == 0 {
            break;
        }
        let chunks_left = (chunk_count - i) as u32;
        // Ceil-divide the remaining budget over the chunks still to process.
        let request = (remaining as u32).div_ceil(chunks_left).max(1);
        match generate_cards_from_text(client, &chunk, request, language).await {
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

    let mut cards = serde_json::from_str::<Vec<GeneratedCard>>(cleaned).map_err(|e| {
        // Truncate the preview — a runaway response shouldn't make the
        // error message itself unmanageable.
        let preview: String = response.chars().take(200).collect();
        ClaudeError::InvalidResponse(format!("Card JSON parse error: {} (got: {})", e, preview))
    })?;

    // P075 — the LLM can emit a card whose `fields` don't match its
    // `template` (e.g. {template:"basic",fields:{text:…}}). That parses fine
    // as a free `Value` but degrades to an empty front/back draft that the
    // persistence layer silently rejects (counted as a failure). Drop cards
    // whose fields don't satisfy the template's contract so the count the
    // user sees reflects genuinely usable cards.
    cards.retain(card_fields_match_template);
    Ok(cards)
}

/// P075 — true when `card.fields` satisfies the contract for `card.template`:
/// `basic` requires non-empty `front` + `back`; `cloze` requires a `text`
/// carrying at least one `{{cN::…}}` deletion. Anything else is a malformed
/// draft we'd only reject downstream, so we drop it here.
fn card_fields_match_template(card: &GeneratedCard) -> bool {
    // A nested `fn` (not a closure) so lifetime elision ties the borrowed
    // `&str` output to the `&Value` input — a closure leaves the two elided
    // lifetimes unrelated and fails to compile.
    fn non_empty_str(v: Option<&serde_json::Value>) -> Option<&str> {
        v.and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
    }
    match card.template {
        CardTemplate::Basic => {
            non_empty_str(card.fields.get("front")).is_some()
                && non_empty_str(card.fields.get("back")).is_some()
        }
        CardTemplate::Cloze => non_empty_str(card.fields.get("text"))
            .map(text_has_cloze_deletion)
            .unwrap_or(false),
    }
}

/// P075 — detect a `{{cN::…}}` cloze deletion. Matches Anki's cloze syntax:
/// `{{c` followed by at least one ASCII digit, then `::`, then a `}}` later.
fn text_has_cloze_deletion(text: &str) -> bool {
    let Some(after) = text.split("{{c").nth(1) else {
        return false;
    };
    // After "{{c" we need: 1+ digits, then "::", then a closing "}}".
    let digits_end = after.find(|c: char| !c.is_ascii_digit()).unwrap_or(0);
    if digits_end == 0 {
        return false;
    }
    let rest = &after[digits_end..];
    rest.strip_prefix("::")
        .map(|r| r.contains("}}"))
        .unwrap_or(false)
}

/// Remove ``` / ```json fences if the model wrapped the JSON, then return the
/// payload. `pub(crate)` so every AI JSON parser (cards, critic, podcast,
/// elaboration) shares ONE robust implementation instead of drifting copies.
///
/// P074 — fixes two failure modes of the old per-module copies:
///   1. A single-line fence (```` ```json [..] ``` ```` with no newline after
///      the tag) left the `json ` token glued to the payload → serde failed.
///      We now also strip a leading lowercase language token + whitespace when
///      no newline follows the opening fence.
///   2. As a last resort we extract the substring between the first opening
///      bracket (`[` or `{`) and its matching last closing bracket, so a stray
///      preamble/epilogue around otherwise-valid JSON still parses.
///
/// Idempotent: already-clean JSON passes through unchanged.
pub(crate) fn strip_code_fences(s: &str) -> &str {
    let mut out = s.trim();

    // Strip an opening fence — accept ```json, ```JSON, ``` and lang tags.
    if let Some(rest) = out.strip_prefix("```") {
        out = match rest.find('\n') {
            // Tag (if any) lives on the fence line; drop through the newline.
            Some(nl) => rest[nl + 1..].trim_end(),
            // No newline: the whole array sits on the fence line, e.g.
            // "```json [..]". Strip a leading lowercase-ASCII language token
            // (json, JSON-lower, …) plus the whitespace gluing it to the JSON.
            None => {
                let tag_len = rest
                    .find(|c: char| !c.is_ascii_lowercase())
                    .unwrap_or(rest.len());
                rest[tag_len..].trim_start().trim_end()
            }
        };
    }
    if let Some(stripped) = out.strip_suffix("```") {
        out = stripped.trim_end();
    }
    out = out.trim();

    // Last-resort: carve out the JSON body if prose still surrounds it. We key
    // off the first opening bracket and the matching kind of last closing
    // bracket so both array and object payloads survive a chatty model.
    if !(out.starts_with('[') || out.starts_with('{')) {
        if let Some(start) = out.find(['[', '{']) {
            let close = if out.as_bytes()[start] == b'[' { ']' } else { '}' };
            if let Some(end) = out.rfind(close) {
                if end > start {
                    return out[start..=end].trim();
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_single_line_json_fence() {
        // P074 — the regression: tag + payload on ONE line, no newline.
        let raw = r#"```json [{"template":"basic","fields":{"front":"Q","back":"A"},"tags":[]}] ```"#;
        let cards = parse_cards_response(raw).expect("single-line fence must parse");
        assert_eq!(cards.len(), 1);
    }

    #[test]
    fn strips_multiline_json_fence() {
        let raw = "```json\n[{\"template\":\"basic\",\"fields\":{\"front\":\"Q\",\"back\":\"A\"},\"tags\":[]}]\n```";
        let cards = parse_cards_response(raw).expect("multiline fence must parse");
        assert_eq!(cards.len(), 1);
    }

    #[test]
    fn extracts_json_from_surrounding_prose() {
        // P074 — chatty model wraps the array in a preamble + epilogue.
        let raw = "Voici les cartes :\n[{\"template\":\"basic\",\"fields\":{\"front\":\"Q\",\"back\":\"A\"},\"tags\":[]}]\nVoilà !";
        let cards = parse_cards_response(raw).expect("prose-wrapped JSON must parse");
        assert_eq!(cards.len(), 1);
    }

    #[test]
    fn drops_card_whose_fields_mismatch_template() {
        // P075 — basic card with cloze-shaped fields → empty draft → dropped.
        let raw = r#"[
            {"template":"basic","fields":{"text":"orphan"},"tags":[]},
            {"template":"basic","fields":{"front":"Q","back":"A"},"tags":[]}
        ]"#;
        let cards = parse_cards_response(raw).expect("parse");
        assert_eq!(cards.len(), 1, "the mismatched basic card must be dropped");
        assert_eq!(cards[0].fields["front"], "Q");
    }

    #[test]
    fn drops_cloze_without_deletion() {
        // P075 — a "cloze" with plain text (no {{cN::}}) is unusable.
        let raw = r#"[
            {"template":"cloze","fields":{"text":"no deletion here"},"tags":[]},
            {"template":"cloze","fields":{"text":"The {{c1::ATP}} is energy"},"tags":[]}
        ]"#;
        let cards = parse_cards_response(raw).expect("parse");
        assert_eq!(cards.len(), 1);
        assert!(text_has_cloze_deletion(
            cards[0].fields["text"].as_str().unwrap()
        ));
    }

    #[test]
    fn cloze_deletion_detector() {
        assert!(text_has_cloze_deletion("a {{c1::x}} b"));
        assert!(text_has_cloze_deletion("{{c12::multi digit}}"));
        assert!(!text_has_cloze_deletion("no cloze"));
        assert!(!text_has_cloze_deletion("{{c::missing digit}}"));
        assert!(!text_has_cloze_deletion("{{c1 missing colons}}"));
        assert!(!text_has_cloze_deletion("{{c1::unterminated"));
    }
}
