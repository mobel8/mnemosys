//! Subtitle importer (Vague 11) — sentence-mining from `.srt` / `.vtt`.
//!
//! Pipeline mirrors the `.apkg` importer ([`crate::apkg`]):
//! - [`parser`] turns a raw subtitle document into `Vec<SubtitleCue>`,
//!   stripping inline formatting and merging multi-line cues.
//! - [`import_cues`] (here) maps each surviving cue onto a Mnemosys note and
//!   inserts it via [`NoteRepo::create`](crate::db::NoteRepo::create).
//!
//! Two import modes:
//! - `"sentence"` → a [`NoteTemplate::Basic`] note `{ front: <cue text>,
//!   back: <placeholder> }`. The learner replaces the placeholder with a
//!   translation later. We can't store an empty `back` — `NoteRepo::create`
//!   rejects empty Basic fields — so we seed it with [`TRANSLATE_PLACEHOLDER`]
//!   (also why we use Basic rather than the Sentence template, which has the
//!   same non-empty `target` requirement).
//! - `"cloze"` → a [`NoteTemplate::Cloze`] note where the single longest word
//!   in the cue is wrapped as `{{c1::word}}`, producing a fill-in-the-blank.
//!
//! Cues that are empty, pure punctuation, or music cues (`♪`, `[music]`) are
//! filtered and reported in [`SubtitleImportResult::skipped_empty`].

pub mod parser;

#[cfg(test)]
mod tests;

pub use parser::{strip_formatting, SubtitleCue};

use serde::{Deserialize, Serialize};

use crate::db::{Database, NoteTemplate};
use crate::error::{AppError, AppResult};

/// Import mode chosen by the user in the UI.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SubtitleMode {
    /// Each cue → a Basic note (front = cue text, back = empty to fill later).
    Sentence,
    /// Each cue → a Cloze note with the longest word blanked.
    Cloze,
}

/// Seed value for the `back` field of `"sentence"`-mode notes. `NoteRepo`
/// forbids an empty Basic field, so we store a visible placeholder the
/// learner overwrites with the real translation.
pub const TRANSLATE_PLACEHOLDER: &str = "(à traduire)";

impl SubtitleMode {
    /// Parse the string the frontend sends (`"sentence"` / `"cloze"`).
    pub fn parse(s: &str) -> AppResult<Self> {
        match s {
            "sentence" => Ok(SubtitleMode::Sentence),
            "cloze" => Ok(SubtitleMode::Cloze),
            other => Err(AppError::Validation(format!(
                "invalid subtitle import mode '{}' (expected 'sentence' or 'cloze')",
                other
            ))),
        }
    }
}

/// Per-import tally surfaced to the UI toast.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SubtitleImportResult {
    /// Cues the parser produced (after formatting strip + multi-line merge).
    pub cues_parsed: usize,
    /// Notes actually inserted.
    pub notes_created: usize,
    /// Cues dropped as empty / music / un-clozable.
    pub skipped_empty: usize,
}

/// Decide whether a cue's text is worth turning into a card.
///
/// Drops music cues (`♪`, `[music]`, `(applause)`) and lines with no
/// alphanumeric content (pure punctuation / dashes). The parser already
/// trims and strips formatting, so this is a content-level filter.
fn is_meaningful(text: &str) -> bool {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return false;
    }
    // Music note glyphs (eighth note, beamed notes) → almost always a jingle.
    if trimmed.contains('\u{266a}') || trimmed.contains('\u{266b}') {
        return false;
    }
    // A line that is entirely wrapped in [...] or (...) is a stage/sound
    // direction (`[music]`, `(door creaks)`) rather than dialogue.
    let bytes = trimmed.as_bytes();
    let bracketed = (bytes.first() == Some(&b'[') && bytes.last() == Some(&b']'))
        || (bytes.first() == Some(&b'(') && bytes.last() == Some(&b')'));
    if bracketed {
        return false;
    }
    // Require at least one alphanumeric character (Unicode-aware) so a line
    // of only dashes / ellipses doesn't become a card.
    trimmed.chars().any(|c| c.is_alphanumeric())
}

/// Pick the single longest word in `text` for the cloze deletion.
///
/// "Longest" is measured in Unicode scalar values after trimming surrounding
/// punctuation. Ties keep the first occurrence. Returns `None` if no word has
/// at least two characters (too short to make a meaningful blank).
fn longest_word(text: &str) -> Option<&str> {
    text.split_whitespace()
        .map(|w| w.trim_matches(|c: char| !c.is_alphanumeric()))
        .filter(|w| w.chars().count() >= 2)
        .max_by_key(|w| w.chars().count())
}

/// Build the cloze `text` field for a cue by wrapping its longest word.
///
/// Only the **first** occurrence of the chosen word is wrapped, so a sentence
/// that repeats the word still produces exactly one `{{c1::…}}` marker.
/// Returns `None` when the cue has no clozable word.
fn build_cloze_text(cue_text: &str) -> Option<String> {
    let word = longest_word(cue_text)?;
    // Replace only the first occurrence to keep a single c1 deletion.
    let replacement = format!("{{{{c1::{}}}}}", word);
    let replaced = cue_text.replacen(word, &replacement, 1);
    Some(replaced)
}

/// Insert every meaningful cue into `deck_id` as notes of the chosen `mode`.
///
/// `source_tag` is added to every created note (defaults to `"subtitles"`) so
/// the learner can filter the imported batch and so the Knowledge Graph links
/// them. Validation failures on a single note are swallowed and counted in
/// `skipped_empty` rather than aborting the whole batch — one malformed cue
/// shouldn't lose the other 800.
pub fn import_cues(
    db: &Database,
    deck_id: i64,
    cues: &[SubtitleCue],
    mode: SubtitleMode,
    source_tag: &str,
) -> AppResult<SubtitleImportResult> {
    let conn = db.lock();

    // Fail fast on a missing deck so the user gets a clear error instead of a
    // pile of foreign-key failures counted as "skipped".
    let _deck = db.decks(&conn).get(deck_id)?;

    let tags = vec![source_tag.to_string()];
    let mut result = SubtitleImportResult {
        cues_parsed: cues.len(),
        ..Default::default()
    };

    for cue in cues {
        if !is_meaningful(&cue.text) {
            result.skipped_empty += 1;
            continue;
        }

        let (template, fields) = match mode {
            SubtitleMode::Sentence => (
                NoteTemplate::Basic,
                serde_json::json!({ "front": cue.text, "back": TRANSLATE_PLACEHOLDER }),
            ),
            SubtitleMode::Cloze => match build_cloze_text(&cue.text) {
                Some(text) => (NoteTemplate::Cloze, serde_json::json!({ "text": text })),
                None => {
                    // No word long enough to blank → skip this cue.
                    result.skipped_empty += 1;
                    continue;
                }
            },
        };

        match db
            .notes(&conn)
            .create(deck_id, template, fields, tags.clone(), None)
        {
            Ok(_) => result.notes_created += 1,
            // A cue that survives `is_meaningful` can still trip note
            // validation (e.g. Basic rejects an empty `front`). Count it as
            // skipped rather than failing the import.
            Err(AppError::Validation(_)) => result.skipped_empty += 1,
            Err(e) => return Err(e),
        }
    }

    Ok(result)
}
