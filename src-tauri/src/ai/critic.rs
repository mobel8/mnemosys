//! Multi-agent card pipeline — the "critic" pass (Vague 13).
//!
//! The card generator ([`super::cards`]) produces a first draft; this module
//! runs a *second* Claude call that plays a pedagogical reviewer. For each
//! card it scores factuality, clarity, atomicity and absence of ambiguity on
//! a 0-1 scale and, when the score is low, proposes a corrected card. This
//! Generator→Critic loop mirrors recent self-refinement work (PROClaim /
//! DebateCV 2025) and measurably lifts the quality of LLM-authored flashcards.
//!
//! Like the rest of [`crate::ai`], the module is side-effect free: it never
//! touches the DB and never reads settings. The command layer resolves the
//! key and decides what to do with the suggested fixes.

use serde::{Deserialize, Serialize};

use super::cards::GeneratedCard;
use super::claude::{ClaudeClient, ClaudeError};

/// One critic verdict for the card at `card_index` in the input slice.
///
/// `score` is the reviewer's overall quality estimate in `[0.0, 1.0]`.
/// `issues` is a short list of human-readable problems (empty when the card
/// is clean). `suggested_fix` carries a rewritten card **only** when the
/// reviewer judged the original below the quality bar — otherwise `None`, so
/// the UI knows there's nothing to apply.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CardCritique {
    pub card_index: usize,
    pub score: f32,
    #[serde(default)]
    pub issues: Vec<String>,
    #[serde(default)]
    pub suggested_fix: Option<GeneratedCard>,
}

/// System prompt for the critic. Same aggressive "JSON array only" discipline
/// as the generator so the response survives `serde_json::from_str`.
const SYSTEM_PROMPT: &str = r#"Tu es un relecteur pédagogique expert en flashcards de répétition espacée.

Pour CHAQUE flashcard fournie, évalue ces critères :
- factualité : l'information est-elle exacte ?
- clarté : la formulation est-elle claire et sans jargon inutile ?
- atomicité : la carte teste-t-elle une seule idée ?
- absence d'ambiguïté : la réponse attendue est-elle unique et non équivoque ?

Règles de sortie :
1. Réponds UNIQUEMENT par un tableau JSON — PAS de fences markdown, PAS de préambule, PAS de prose finale.
2. Un objet par carte d'entrée, dans le MÊME ordre.
3. Chaque objet a les clés : "card_index" (entier, 0-based), "score" (nombre 0.0-1.0), "issues" (tableau de chaînes courtes), "suggested_fix" (objet carte ou null).
4. "score" agrège la qualité globale. Si score < 0.7, "suggested_fix" DOIT contenir une version corrigée.
5. Si score >= 0.7, "issues" peut être vide et "suggested_fix" vaut null.
6. Une carte corrigée a exactement trois clés : "template" ("basic" ou "cloze"), "fields", "tags".
   - basic : fields = {"front": "...", "back": "..."}.
   - cloze : fields = {"text": "Phrase avec {{c1::texte caché}}"}.
7. Reste dans la langue de la carte d'origine. N'invente jamais de faits non vérifiables.

Exemple de sortie (et UNIQUEMENT ce type de sortie) :
[
  {"card_index":0,"score":0.92,"issues":[],"suggested_fix":null},
  {"card_index":1,"score":0.4,"issues":["Deux idées en une carte","Réponse ambiguë"],"suggested_fix":{"template":"basic","fields":{"front":"Q reformulée ?","back":"R"},"tags":["topic"]}}
]
"#;

/// Output cap. A critique is more verbose than a card (it may echo a full
/// corrected card per entry) so we mirror the generator's generous 8k budget.
const MAX_OUTPUT_TOKENS: u32 = 8000;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Run the critic pass over a batch of freshly-generated cards.
///
/// Returns one [`CardCritique`] per input card (order preserved). An empty
/// input short-circuits without an API call. The caller is responsible for
/// surfacing scores / applying `suggested_fix` — this function is pure
/// transport + parsing.
pub async fn critique_cards(
    client: &ClaudeClient,
    cards: &[GeneratedCard],
) -> Result<Vec<CardCritique>, ClaudeError> {
    if cards.is_empty() {
        return Ok(Vec::new());
    }

    // Serialize the cards so the reviewer sees the exact JSON shape it must
    // critique. `serde_json::to_string` can't fail for our owned types, but
    // we surface a transport-flavoured error rather than unwrapping in prod.
    let cards_json = serde_json::to_string(cards)
        .map_err(|e| ClaudeError::InvalidResponse(format!("serialize cards: {e}")))?;

    let prompt = format!(
        "Évalue les {n} flashcards ci-dessous. Renvoie UNIQUEMENT le tableau JSON \
         des critiques, un objet par carte, dans le même ordre.\n\n\
         Cartes:\n{cards_json}",
        n = cards.len()
    );

    let response = client
        .complete(Some(SYSTEM_PROMPT), &prompt, MAX_OUTPUT_TOKENS)
        .await?;

    parse_critique_response(&response)
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/// Strip markdown fences if present and parse the critic JSON array.
///
/// Pulled out so it's unit-testable without an HTTP call.
pub(super) fn parse_critique_response(response: &str) -> Result<Vec<CardCritique>, ClaudeError> {
    let cleaned = strip_code_fences(response.trim());

    serde_json::from_str::<Vec<CardCritique>>(cleaned).map_err(|e| {
        let preview: String = response.chars().take(200).collect();
        ClaudeError::InvalidResponse(format!("Critique JSON parse error: {e} (got: {preview})"))
    })
}

/// Remove ``` or ```json fences if the model wrapped the array. Idempotent.
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::cards::CardTemplate;

    #[test]
    fn parses_clean_critique_array() {
        let raw = r#"[
            {"card_index":0,"score":0.9,"issues":[],"suggested_fix":null},
            {"card_index":1,"score":0.45,"issues":["Deux idées","Ambigu"],
             "suggested_fix":{"template":"basic","fields":{"front":"Q ?","back":"R"},"tags":["t"]}}
        ]"#;
        let crit = parse_critique_response(raw).expect("clean JSON must parse");
        assert_eq!(crit.len(), 2);

        assert_eq!(crit[0].card_index, 0);
        assert!((crit[0].score - 0.9).abs() < 1e-6);
        assert!(crit[0].issues.is_empty());
        assert!(crit[0].suggested_fix.is_none());

        assert_eq!(crit[1].card_index, 1);
        assert_eq!(crit[1].issues.len(), 2);
        let fix = crit[1]
            .suggested_fix
            .as_ref()
            .expect("low score must carry a fix");
        assert!(matches!(fix.template, CardTemplate::Basic));
        assert_eq!(fix.fields["front"], "Q ?");
    }

    #[test]
    fn parses_critique_with_markdown_fences() {
        let raw =
            "```json\n[{\"card_index\":0,\"score\":1.0,\"issues\":[],\"suggested_fix\":null}]\n```";
        let crit = parse_critique_response(raw).expect("fenced JSON must parse");
        assert_eq!(crit.len(), 1);
        assert!((crit[0].score - 1.0).abs() < 1e-6);
    }

    #[test]
    fn missing_optional_fields_default_cleanly() {
        // `issues` and `suggested_fix` are `#[serde(default)]` so a terse
        // reviewer response that omits them must still parse.
        let raw = r#"[{"card_index":0,"score":0.8}]"#;
        let crit = parse_critique_response(raw).expect("terse JSON must parse");
        assert_eq!(crit.len(), 1);
        assert!(crit[0].issues.is_empty());
        assert!(crit[0].suggested_fix.is_none());
    }

    #[test]
    fn garbage_response_errors() {
        let raw = "Désolé, je ne peux pas évaluer ces cartes.";
        let err = parse_critique_response(raw).expect_err("garbage must error");
        assert!(matches!(err, ClaudeError::InvalidResponse(_)));
    }
}
