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
/// Returns one [`CardCritique`] per input card, re-ordered so `out[i]`
/// describes input card `i` (callers join by position). An empty input
/// short-circuits without an API call. If the model returns the wrong number
/// of verdicts, or `card_index` values that aren't a clean permutation of
/// `0..n`, the whole pass fails with [`ClaudeError::InvalidResponse`] — the
/// critique is advisory, so it's better to drop it than to attach a score to
/// the wrong card. The caller is responsible for surfacing scores / applying
/// `suggested_fix`.
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

    let critiques = parse_critique_response(&response)?;
    // The caller (and the UI) join each verdict to its card *by position*, so a
    // wrong count or a bogus `card_index` would silently mis-attribute scores
    // and suggested fixes to the wrong card. Reject anything that isn't a clean
    // 1:1 mapping and return the verdicts re-ordered to `cards`' order, so the
    // critique pass is abandoned (advisory) on mismatch rather than corrupting
    // the user's drafts.
    validate_and_align(critiques, cards.len())
}

/// Enforce that `critiques` is a valid 1:1 mapping onto the `n` input cards and
/// return them re-ordered so `out[i]` is the verdict for input card `i`.
///
/// "Valid" means: exactly `n` verdicts whose `card_index` values are a
/// permutation of `0..n` (each index present exactly once, none out of range).
/// Any deviation yields [`ClaudeError::InvalidResponse`] so the caller drops the
/// (advisory) critique rather than attaching a score to the wrong card.
fn validate_and_align(
    critiques: Vec<CardCritique>,
    n: usize,
) -> Result<Vec<CardCritique>, ClaudeError> {
    if critiques.len() != n {
        return Err(ClaudeError::InvalidResponse(format!(
            "critique count mismatch: got {} verdict(s) for {n} card(s)",
            critiques.len()
        )));
    }

    // Slot each verdict by its self-declared index, rejecting out-of-range or
    // duplicate indices — together with the length check above this proves the
    // indices form a permutation of `0..n`.
    let mut slots: Vec<Option<CardCritique>> = (0..n).map(|_| None).collect();
    for c in critiques {
        let Some(slot) = slots.get_mut(c.card_index) else {
            return Err(ClaudeError::InvalidResponse(format!(
                "critique card_index {} out of range for {n} card(s)",
                c.card_index
            )));
        };
        if slot.is_some() {
            return Err(ClaudeError::InvalidResponse(format!(
                "duplicate critique for card_index {}",
                c.card_index
            )));
        }
        *slot = Some(c);
    }

    // Every slot is now filled (n verdicts, n distinct in-range indices).
    Ok(slots.into_iter().flatten().collect())
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

    /// Build a trivially-clean verdict for `card_index` (score 1.0, no fix).
    fn verdict(card_index: usize) -> CardCritique {
        CardCritique {
            card_index,
            score: 1.0,
            issues: Vec::new(),
            suggested_fix: None,
        }
    }

    #[test]
    fn validate_and_align_reorders_a_permutation() {
        // Model returned the verdicts out of order (indices 2,0,1). They must
        // be re-slotted so `out[i].card_index == i`.
        let scrambled = vec![
            CardCritique {
                card_index: 2,
                score: 0.2,
                ..verdict(2)
            },
            CardCritique {
                card_index: 0,
                score: 0.9,
                ..verdict(0)
            },
            CardCritique {
                card_index: 1,
                score: 0.5,
                ..verdict(1)
            },
        ];
        let aligned = validate_and_align(scrambled, 3).expect("clean permutation must pass");
        assert_eq!(aligned.len(), 3);
        assert_eq!(aligned[0].card_index, 0);
        assert!((aligned[0].score - 0.9).abs() < 1e-6);
        assert_eq!(aligned[1].card_index, 1);
        assert!((aligned[1].score - 0.5).abs() < 1e-6);
        assert_eq!(aligned[2].card_index, 2);
        assert!((aligned[2].score - 0.2).abs() < 1e-6);
    }

    #[test]
    fn validate_and_align_rejects_count_mismatch() {
        // Two verdicts for three cards: abandon rather than mis-attribute.
        let err = validate_and_align(vec![verdict(0), verdict(1)], 3)
            .expect_err("short count must error");
        assert!(matches!(err, ClaudeError::InvalidResponse(_)));
    }

    #[test]
    fn validate_and_align_rejects_out_of_range_index() {
        // Right count, but an index points past the input slice.
        let err = validate_and_align(vec![verdict(0), verdict(5)], 2)
            .expect_err("out-of-range index must error");
        assert!(matches!(err, ClaudeError::InvalidResponse(_)));
    }

    #[test]
    fn validate_and_align_rejects_duplicate_index() {
        // Right count, in range, but card 1 is described twice and card 0 not
        // at all — not a permutation, so we can't trust the mapping.
        let err = validate_and_align(vec![verdict(1), verdict(1)], 2)
            .expect_err("duplicate index must error");
        assert!(matches!(err, ClaudeError::InvalidResponse(_)));
    }
}
