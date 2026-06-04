//! Mnemonic helper (Vague 13).
//!
//! For a card the learner keeps forgetting (high FSRS `lapses`), this module
//! asks Claude for a vivid memory aid — an absurd mental image, an acronym,
//! or a strong association — to anchor the `front → back` mapping. The output
//! is plain prose (2-3 sentences), so unlike the card generator there's no
//! JSON contract to enforce: we just trim the model's reply.
//!
//! Side-effect free, like the rest of [`crate::ai`]: the command layer
//! resolves the API key, loads the card's front/back, and surfaces the
//! resulting string to the UI.

use super::claude::{ClaudeClient, ClaudeError};

/// System prompt. Kept LANGUAGE-NEUTRAL (English instructions) so the output
/// language is driven solely by the request's `language` hint — P116: the old
/// French-only prompt biased every mnemonic toward French even when the user
/// picked en/es/de/… The "no preamble" nudge avoids a wrapper we'd strip.
const SYSTEM_PROMPT: &str = r#"You are an expert in memorization techniques (mnemonics).

You produce one vivid, memorable mnemonic aid to durably anchor an association:
an absurd mental image, an acronym, or a strong association.

Rules:
1. 2 to 3 sentences maximum. Be concrete and striking.
2. Reply ONLY with the mnemonic aid — NO preamble, NO meta-commentary.
3. Write the ENTIRE response in the requested output language, and only that language.
4. Never invent facts: rely only on the supplied content.
"#;

/// Output cap. Three sentences fit comfortably; we leave headroom for a
/// language whose tokenizer is less dense than English.
const MAX_OUTPUT_TOKENS: u32 = 400;

/// Ask Claude for a mnemonic anchoring `front → back`.
///
/// `language` is forwarded verbatim (`"fr"`, `"en"`, …). `back` may be empty
/// for cloze-style prompts where `front` already carries the full sentence —
/// the prompt copes either way. The returned string is trimmed; an empty
/// reply surfaces as an [`ClaudeError::InvalidResponse`] so the UI can show a
/// retry hint rather than an empty toast.
pub async fn generate_mnemonic(
    client: &ClaudeClient,
    front: &str,
    back: &str,
    language: &str,
) -> Result<String, ClaudeError> {
    let front = front.trim();
    let back = back.trim();

    // P116 — frame the request in language-NEUTRAL English so only the
    // `language` hint controls the output language. When `back` is empty
    // (cloze), ask for an aid to remember the sentence itself rather than a
    // "→ ()" arrow.
    let mapping = if back.is_empty() {
        format!("Help memorize: « {front} »")
    } else {
        format!("Help memorize that « {front} » → « {back} »")
    };

    let prompt = format!(
        "{mapping}.\nOutput language: {language}. \
         Reply ONLY with the mnemonic aid (2-3 sentences max), written entirely in {language}."
    );

    let response = client
        .complete(Some(SYSTEM_PROMPT), &prompt, MAX_OUTPUT_TOKENS)
        .await?;

    let trimmed = response.trim().to_string();
    if trimmed.is_empty() {
        return Err(ClaudeError::InvalidResponse(
            "mnemonic response was empty".to_string(),
        ));
    }
    Ok(trimmed)
}
