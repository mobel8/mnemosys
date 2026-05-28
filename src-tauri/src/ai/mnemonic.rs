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

/// System prompt. Keeps the model terse and on-task; the "no preamble" nudge
/// avoids a "Voici une astuce :" wrapper we'd otherwise have to strip.
const SYSTEM_PROMPT: &str = r#"Tu es un expert en techniques de mémorisation (mnémotechnie).

Tu produis une aide mnémotechnique vivante et mémorable pour ancrer durablement
une association à retenir : image mentale absurde, acronyme, ou association forte.

Règles :
1. 2 à 3 phrases maximum. Sois concret et frappant.
2. Réponds UNIQUEMENT avec l'aide mnémotechnique — PAS de préambule, PAS de méta-commentaire.
3. Reste dans la langue demandée.
4. N'invente aucun fait : appuie-toi uniquement sur le contenu fourni.
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

    // Build the mapping line defensively: when `back` is empty (cloze), ask
    // for an aid to remember the sentence itself rather than a "→ ()" arrow.
    let mapping = if back.is_empty() {
        format!("Aide à retenir : « {front} »")
    } else {
        format!("Aide à retenir que « {front} » → « {back} »")
    };

    let prompt = format!(
        "{mapping}.\nLangue de sortie : {language}. \
         Réponds UNIQUEMENT avec l'aide mnémotechnique (2-3 phrases max)."
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
