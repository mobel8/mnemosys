//! Maps an [`AnkiCollection`] onto the live Mnemosys database.
//!
//! Model mapping:
//! - Anki "Basic" (2 fields, non-cloze)             → [`NoteTemplate::Basic`]
//! - Anki "Basic (and reversed card)" (`is_cloze=0`, ≥2 fields, name hint
//!   "reverse" / "reversed") → [`NoteTemplate::BasicReverse`]
//! - Anki "Cloze" (`is_cloze=1`)                    → [`NoteTemplate::Cloze`]
//! - Anything else → counted in `notes_skipped` and dropped.
//!
//! Conflict policy: an Anki deck whose name already exists in Mnemosys is
//! skipped wholesale (its notes are NOT merged into the existing deck).
//! The skipped names are returned so the UI can surface them.

use std::collections::{HashMap, HashSet};

use serde_json::json;

use super::parser::{AnkiCollection, AnkiModel};
use crate::db::{Database, NoteTemplate};
use crate::error::{AppError, AppResult};

#[derive(Debug, serde::Serialize)]
pub struct ConversionResult {
    pub stats: ConversionStats,
    /// Names of Anki decks that were skipped because Mnemosys already had a
    /// deck with the same name.
    pub skipped_decks: Vec<String>,
}

#[derive(Debug, Default, Clone, serde::Serialize)]
pub struct ConversionStats {
    pub decks_imported: usize,
    pub notes_imported: usize,
    /// Notes dropped because their model isn't supported, the required deck
    /// was skipped, or the field payload didn't satisfy `NoteRepo::create`
    /// (e.g. empty front/back, cloze with no `{{cN::…}}` marker).
    pub notes_skipped: usize,
    /// Notes whose parent deck had no Anki `cards` row pointing at them
    /// (orphan notes — common after a partial Anki export).
    pub cards_skipped_no_anki_card: usize,
}

/// Default per-deck swatch list. We index into it modulo the deck count so
/// imports never collapse onto a single colour even on big shared decks.
const DECK_COLORS: &[&str] = &[
    "#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#06b6d4", "#6b7280",
];

/// Insert every supported deck / note from `anki` into `db`. Returns a
/// per-section count plus the names of any decks that were skipped.
pub fn convert_to_mnemosys(db: &Database, anki: AnkiCollection) -> AppResult<ConversionResult> {
    let conn = db.lock();

    // Index models by id so we don't do a linear scan per note.
    let models_by_id: HashMap<i64, &AnkiModel> =
        anki.models.iter().map(|m| (m.id, m)).collect();

    // Anki notes with zero cards (orphans) are rare but not impossible.
    // Build a quick `note_id -> Vec<deck_id>` index so we can both detect
    // orphans and figure out the destination deck per note.
    let mut notes_with_cards: HashMap<i64, Vec<i64>> = HashMap::new();
    for card in &anki.cards {
        notes_with_cards
            .entry(card.note_id)
            .or_default()
            .push(card.deck_id);
    }

    // Map Anki deck_id → Mnemosys deck_id (filled as we create rows).
    let mut deck_id_map: HashMap<i64, i64> = HashMap::new();
    let mut skipped_decks: Vec<String> = Vec::new();
    let existing_names: HashSet<String> = db
        .decks(&conn)
        .list()?
        .into_iter()
        .map(|d| d.name)
        .collect();

    for (idx, anki_deck) in anki.decks.iter().enumerate() {
        // Anki always ships a built-in "Default" deck (id=1). Importing it
        // would clash with any user-created deck of the same name, so skip
        // unless the .apkg actually attaches notes to a renamed "Default".
        if anki_deck.id == 1 && anki_deck.name == "Default" {
            continue;
        }
        if existing_names.contains(&anki_deck.name) {
            skipped_decks.push(anki_deck.name.clone());
            continue;
        }
        let color = DECK_COLORS[idx % DECK_COLORS.len()];
        let new_deck = db.decks(&conn).create(
            &anki_deck.name,
            anki_deck.description.as_deref(),
            color,
            0.9,
            None,
            None,
        )?;
        deck_id_map.insert(anki_deck.id, new_deck.id);
    }

    let mut stats = ConversionStats {
        decks_imported: deck_id_map.len(),
        ..Default::default()
    };

    for note in &anki.notes {
        let card_decks = match notes_with_cards.get(&note.id) {
            Some(d) => d,
            None => {
                stats.cards_skipped_no_anki_card += 1;
                continue;
            }
        };

        // Anki notes can technically span multiple decks (one card per deck
        // for sibling cards). We park them all in the first deck — Mnemosys
        // doesn't have the same per-card deck split.
        let target_deck_id = match deck_id_map.get(&card_decks[0]) {
            Some(d) => *d,
            None => {
                // Parent deck was skipped (duplicate name or "Default").
                stats.notes_skipped += 1;
                continue;
            }
        };

        let model = match models_by_id.get(&note.model_id) {
            Some(m) => *m,
            None => {
                stats.notes_skipped += 1;
                continue;
            }
        };

        let (template, fields) = match build_note_payload(model, &note.fields) {
            Some(pair) => pair,
            None => {
                stats.notes_skipped += 1;
                continue;
            }
        };

        // NoteRepo::create validates fields (non-empty front/back, ≥1 cloze
        // marker). Anything it refuses we count as `skipped` rather than
        // aborting the whole import.
        match db
            .notes(&conn)
            // Anki packages don't carry a frequency_band, so import as None.
            // The learner can tag notes manually post-import.
            .create(target_deck_id, template, fields, note.tags.clone(), None)
        {
            Ok(_) => stats.notes_imported += 1,
            Err(AppError::Validation(_)) => stats.notes_skipped += 1,
            Err(e) => return Err(e),
        }
    }

    Ok(ConversionResult {
        stats,
        skipped_decks,
    })
}

/// Choose the destination [`NoteTemplate`] and build its JSON `fields` blob.
/// Returns `None` if the model has too few fields to even attempt the
/// import — caller bumps `notes_skipped`.
fn build_note_payload(
    model: &AnkiModel,
    fields: &[String],
) -> Option<(NoteTemplate, serde_json::Value)> {
    if model.is_cloze {
        let text = fields.first().cloned().unwrap_or_default();
        if text.trim().is_empty() {
            return None;
        }
        return Some((NoteTemplate::Cloze, json!({ "text": text })));
    }

    if fields.len() < 2 {
        return None;
    }
    let front = fields[0].clone();
    let back = fields[1].clone();
    if front.trim().is_empty() || back.trim().is_empty() {
        return None;
    }

    // "Basic (and reversed card)" — case-insensitive substring match keeps
    // us compatible with localised Anki UIs that translate the model name.
    let lname = model.name.to_lowercase();
    let is_reverse = lname.contains("reverse") || lname.contains("reversed");
    let template = if is_reverse {
        NoteTemplate::BasicReverse
    } else {
        NoteTemplate::Basic
    };
    Some((template, json!({ "front": front, "back": back })))
}
