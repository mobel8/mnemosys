//! Note repository — the user-facing content unit.
//!
//! A note holds the raw fields (front/back text, cloze source, etc.) and is
//! the parent of one or more cards. Note creation also creates the matching
//! card rows, in a single transaction.
//!
//! `fields` is stored as a JSON object string. Conventions:
//! - `basic`         → `{ "front": "...", "back": "..." }`
//! - `basic_reverse` → `{ "front": "...", "back": "..." }` (two cards: 0=F→B, 1=B→F)
//! - `cloze`         → `{ "text": "The {{c1::capital}} of {{c2::France}} is Paris" }`
//! - `occlusion`     → `{ "image_path": "/abs/path", "natural_width": 800,
//!                       "natural_height": 600,
//!                       "masks": [{ "x": 0, "y": 0, "width": 100, "height": 50,
//!                                   "label": "optional" }, ...] }`
//!                    One card per mask (`card_ord = mask_index`).
//! - `sentence`      → `{ "source": "...", "target": "...",
//!                        "notes": "optional", "source_lang": "ja",
//!                        "target_lang": "fr" }` — one card (source→target).
//! - `bidirectional` → `{ "source": "...", "target": "..." }` — two cards,
//!                     the Lampariello pattern (0=source→target, 1=target→source).
//! - `illness_script` → `{ "condition": "...", "epidemiology": "...",
//!                        "pathophysiology": "...", "clinical": "...",
//!                        "management": "..." }` (Vague 14, médecine — Charlin
//!                        2007). One card: recto = condition, verso = the four
//!                        sections. `condition` is required; at least one of
//!                        the four sections must be non-empty.
//! - `refutation`    → `{ "misconception": "...", "correct": "...",
//!                        "explanation": "..." }` (Vague 14, sciences — Tippett
//!                        2010 meta). One card confronting a false belief:
//!                        recto = « Vrai ou faux ? {misconception} », verso =
//!                        « FAUX. {correct} » + explanation. `misconception`
//!                        and `correct` are both required.
//! - `worked_example` → `{ "problem": "...", "steps": ["...", "..."],
//!                        "answer": "..." }` (Vague 15, maths — Sweller/Renkl/
//!                        Atkinson 2003 faded worked example). One card: recto =
//!                        the problem, verso reveals the solution `steps` one by
//!                        one (the learner predicts each), then the final
//!                        `answer`. `problem` and `answer` are required and the
//!                        `steps` array must hold at least one non-empty string.
//!
//! Vague 10 also introduces an optional `frequency_band` column on every
//! note (independent of `template`): one of `top_100`, `top_1k`, `top_5k`,
//! `top_10k`, `beyond`, or NULL when un-tagged.

use std::collections::BTreeSet;
use std::str::FromStr;

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

use super::cards::CardRepo;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NoteTemplate {
    Basic,
    BasicReverse,
    Cloze,
    Occlusion,
    /// Vague 10 — one-card sentence (source → target, language-learning).
    Sentence,
    /// Vague 10 — two-card bidirectional translation pair (Lampariello).
    Bidirectional,
    /// Vague 14 — clinical illness script (médecine, Charlin 2007). One card:
    /// recto = condition, verso = the four structured sections.
    IllnessScript,
    /// Vague 14 — refutation card (sciences, Tippett 2010 meta). One card
    /// confronting a misconception with the correct statement + explanation.
    Refutation,
    /// Vague 15 — faded worked example (maths, Sweller/Renkl/Atkinson 2003).
    /// One card: recto = problem, verso reveals solution steps progressively
    /// then the final answer.
    WorkedExample,
}

impl NoteTemplate {
    pub fn as_str(self) -> &'static str {
        match self {
            NoteTemplate::Basic => "basic",
            NoteTemplate::BasicReverse => "basic_reverse",
            NoteTemplate::Cloze => "cloze",
            NoteTemplate::Occlusion => "occlusion",
            NoteTemplate::Sentence => "sentence",
            NoteTemplate::Bidirectional => "bidirectional",
            NoteTemplate::IllnessScript => "illness_script",
            NoteTemplate::Refutation => "refutation",
            NoteTemplate::WorkedExample => "worked_example",
        }
    }
}

impl FromStr for NoteTemplate {
    type Err = AppError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "basic" => Ok(NoteTemplate::Basic),
            "basic_reverse" => Ok(NoteTemplate::BasicReverse),
            "cloze" => Ok(NoteTemplate::Cloze),
            "occlusion" => Ok(NoteTemplate::Occlusion),
            "sentence" => Ok(NoteTemplate::Sentence),
            "bidirectional" => Ok(NoteTemplate::Bidirectional),
            "illness_script" => Ok(NoteTemplate::IllnessScript),
            "refutation" => Ok(NoteTemplate::Refutation),
            "worked_example" => Ok(NoteTemplate::WorkedExample),
            other => Err(AppError::Database(format!(
                "invalid note template '{}'",
                other
            ))),
        }
    }
}

/// Vague 10 — accepted values for the optional `notes.frequency_band` column.
const FREQUENCY_BANDS: &[&str] = &["top_100", "top_1k", "top_5k", "top_10k", "beyond"];

/// Validate that `band` is either `None` or one of the accepted bucket
/// names. The check is duplicated in SQL (the `CHECK` constraint catches
/// a corrupted write); here we surface a friendly `Validation` error
/// before the SQL even runs.
fn validate_frequency_band(band: Option<&str>) -> AppResult<()> {
    match band {
        None => Ok(()),
        Some(value) => {
            if FREQUENCY_BANDS.contains(&value) {
                Ok(())
            } else {
                Err(AppError::Validation(format!(
                    "invalid frequency_band '{}' (expected one of {:?})",
                    value, FREQUENCY_BANDS
                )))
            }
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Note {
    pub id: i64,
    pub deck_id: i64,
    pub template: NoteTemplate,
    pub fields: serde_json::Value,
    pub tags: Vec<String>,
    pub created_at: i64,
    pub updated_at: i64,
    /// Vague 10 — Zipf-bucket label for language-learning notes
    /// (`top_100` … `beyond`). `None` when un-tagged. Backwards-compatible:
    /// every pre-v11 row migrates to `NULL`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub frequency_band: Option<String>,
}

pub struct NoteRepo<'a> {
    conn: &'a Connection,
}

impl<'a> NoteRepo<'a> {
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }

    pub fn list_in_deck(
        &self,
        deck_id: i64,
        limit: u32,
        offset: u32,
    ) -> AppResult<Vec<Note>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, deck_id, template, fields, tags, created_at, updated_at, frequency_band
             FROM notes
             WHERE deck_id = ?1
             ORDER BY id DESC
             LIMIT ?2 OFFSET ?3",
        )?;
        let rows = stmt.query_map(params![deck_id, limit, offset], row_to_note)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r??);
        }
        Ok(out)
    }

    pub fn get(&self, id: i64) -> AppResult<Note> {
        let row = self
            .conn
            .query_row(
                "SELECT id, deck_id, template, fields, tags, created_at, updated_at, frequency_band
                 FROM notes WHERE id = ?1",
                params![id],
                row_to_note,
            )
            .optional()?;
        match row {
            Some(Ok(n)) => Ok(n),
            Some(Err(e)) => Err(e),
            None => Err(AppError::NotFound(format!("note id={}", id))),
        }
    }

    /// Create a note and all its derived cards in a single transaction.
    ///
    /// Card count by template:
    /// - `Basic`         → 1 card (ord=0)
    /// - `BasicReverse`  → 2 cards (ord=0 front→back, ord=1 back→front)
    /// - `Cloze`         → one card per unique `{{cN::…}}` index found in the
    ///   `text` field; if no cloze is found, returns a `Validation` error.
    /// - `Occlusion`     → one card per entry in `fields.masks` (a JSON array).
    ///   Empty or missing `masks` is rejected with a `Validation` error.
    /// - `Sentence`      → 1 card (ord=0 source→target).
    /// - `Bidirectional` → 2 cards (ord=0 source→target, ord=1 target→source).
    /// - `IllnessScript` → 1 card (ord=0 condition→clinical sections).
    /// - `Refutation`    → 1 card (ord=0 misconception→correction).
    /// - `WorkedExample` → 1 card (ord=0 problem→steps→answer).
    ///
    /// `frequency_band` is optional (Vague 10). When `Some`, the value must
    /// be one of `top_100`, `top_1k`, `top_5k`, `top_10k`, `beyond` —
    /// anything else returns a `Validation` error before the INSERT runs.
    pub fn create(
        &self,
        deck_id: i64,
        template: NoteTemplate,
        fields: serde_json::Value,
        tags: Vec<String>,
        frequency_band: Option<String>,
    ) -> AppResult<Note> {
        validate_fields(template, &fields)?;
        validate_frequency_band(frequency_band.as_deref())?;

        let now = Utc::now().timestamp();
        let fields_str = serde_json::to_string(&fields)?;
        let tags_str = serde_json::to_string(&tags)?;

        // Manual transaction: the borrow checker doesn't let us hand out
        // both an &Connection (for CardRepo) and a Transaction at once on
        // rusqlite 0.39, so we drive BEGIN/COMMIT directly. Any error path
        // performs a best-effort ROLLBACK before bubbling up.
        self.conn.execute_batch("BEGIN;")?;

        let insert_res = self.conn.execute(
            "INSERT INTO notes (deck_id, template, fields, tags, created_at, updated_at, frequency_band)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6)",
            params![
                deck_id,
                template.as_str(),
                fields_str,
                tags_str,
                now,
                frequency_band
            ],
        );
        if let Err(e) = insert_res {
            let _ = self.conn.execute_batch("ROLLBACK;");
            return Err(e.into());
        }
        let note_id = self.conn.last_insert_rowid();

        let card_ords = ords_for_template(template, &fields)?;
        let cards = CardRepo::new(self.conn);
        for ord in card_ords {
            if let Err(e) = cards.create_for_note(note_id, deck_id, ord) {
                let _ = self.conn.execute_batch("ROLLBACK;");
                return Err(e);
            }
        }

        self.conn.execute_batch("COMMIT;")?;
        self.get(note_id)
    }

    /// Vague 10 — set or clear the `frequency_band` tag on an existing note.
    /// Passing `None` clears the tag. Validation runs both server-side
    /// (via [`validate_frequency_band`]) and in SQL (the `CHECK` constraint).
    pub fn set_frequency_band(&self, id: i64, band: Option<String>) -> AppResult<Note> {
        validate_frequency_band(band.as_deref())?;
        // Reject early if the note doesn't exist — gives a friendlier error.
        let _existing = self.get(id)?;
        let now = Utc::now().timestamp();
        let affected = self.conn.execute(
            "UPDATE notes SET frequency_band = ?1, updated_at = ?2 WHERE id = ?3",
            params![band, now, id],
        )?;
        if affected == 0 {
            return Err(AppError::NotFound(format!("note id={}", id)));
        }
        self.get(id)
    }

    pub fn update_fields(&self, id: i64, fields: serde_json::Value) -> AppResult<Note> {
        let existing = self.get(id)?;
        validate_fields(existing.template, &fields)?;

        let now = Utc::now().timestamp();
        let fields_str = serde_json::to_string(&fields)?;
        self.conn.execute(
            "UPDATE notes SET fields = ?1, updated_at = ?2 WHERE id = ?3",
            params![fields_str, now, id],
        )?;
        self.get(id)
    }

    pub fn delete(&self, id: i64) -> AppResult<()> {
        let affected = self
            .conn
            .execute("DELETE FROM notes WHERE id = ?1", params![id])?;
        if affected == 0 {
            return Err(AppError::NotFound(format!("note id={}", id)));
        }
        Ok(())
    }

    /// FTS5-backed full-text search over `fields` and `tags`.
    ///
    /// Uses the trigram tokenizer so substring matches work even for short
    /// queries. The user query is wrapped in quotes to neutralise FTS5
    /// operators (so a stray `OR` or `*` doesn't surprise users).
    pub fn search(&self, query: &str, limit: u32) -> AppResult<Vec<Note>> {
        let trimmed = query.trim();
        if trimmed.is_empty() {
            return Ok(Vec::new());
        }
        // Escape any embedded double-quotes (FTS5 uses "" to escape inside a quoted phrase).
        let escaped = trimmed.replace('"', "\"\"");
        let fts_query = format!("\"{}\"", escaped);

        let mut stmt = self.conn.prepare(
            "SELECT n.id, n.deck_id, n.template, n.fields, n.tags, n.created_at, n.updated_at, n.frequency_band
             FROM notes n
             JOIN notes_fts fts ON fts.rowid = n.id
             WHERE notes_fts MATCH ?1
             ORDER BY bm25(notes_fts) ASC
             LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![fts_query, limit], row_to_note)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r??);
        }
        Ok(out)
    }

    pub fn count_in_deck(&self, deck_id: i64) -> AppResult<i64> {
        let n: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM notes WHERE deck_id = ?1",
            params![deck_id],
            |r| r.get(0),
        )?;
        Ok(n)
    }

    /// Vague 10 — tally the deck's notes by their `frequency_band` column.
    ///
    /// One indexed `GROUP BY`; NULL bands fold into `untagged`. The six
    /// returned counts always sum to [`count_in_deck`]. Unknown band values
    /// are skipped (the SQL CHECK constraint already guards writes), so a
    /// hand-corrupted row can't crash the coverage card.
    pub fn frequency_coverage(&self, deck_id: i64) -> AppResult<FrequencyCoverage> {
        let mut stmt = self.conn.prepare(
            "SELECT frequency_band, COUNT(*) FROM notes WHERE deck_id = ?1 GROUP BY frequency_band",
        )?;
        let rows = stmt.query_map(params![deck_id], |r| {
            let band: Option<String> = r.get(0)?;
            let count: i64 = r.get(1)?;
            Ok((band, count))
        })?;

        let mut coverage = FrequencyCoverage::default();
        for row in rows {
            let (band, count) = row?;
            match band.as_deref() {
                Some("top_100") => coverage.top_100 = count,
                Some("top_1k") => coverage.top_1k = count,
                Some("top_5k") => coverage.top_5k = count,
                Some("top_10k") => coverage.top_10k = count,
                Some("beyond") => coverage.beyond = count,
                None => coverage.untagged = count,
                Some(_) => {} // unknown band — ignore (CHECK constraint guards writes)
            }
        }
        Ok(coverage)
    }

    /// Vague 11 — return the tag list of every note, optionally scoped to one
    /// deck. Each inner `Vec<String>` is one note's tags (the `tags` column is
    /// a JSON array). Used to build the Knowledge Graph's tag co-occurrence
    /// edges without materialising full [`Note`] rows. Notes whose `tags`
    /// column fails to parse are skipped rather than aborting the query.
    pub fn all_tags(&self, deck_id: Option<i64>) -> AppResult<Vec<Vec<String>>> {
        let mut out = Vec::new();
        // Two near-identical statements keep the SQL parameter binding simple
        // (rusqlite doesn't love optional params in one prepared statement).
        match deck_id {
            Some(id) => {
                let mut stmt = self
                    .conn
                    .prepare("SELECT tags FROM notes WHERE deck_id = ?1")?;
                let rows = stmt.query_map(params![id], |r| r.get::<_, String>(0))?;
                for row in rows {
                    if let Ok(tags) = serde_json::from_str::<Vec<String>>(&row?) {
                        out.push(tags);
                    }
                }
            }
            None => {
                let mut stmt = self.conn.prepare("SELECT tags FROM notes")?;
                let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
                for row in rows {
                    if let Ok(tags) = serde_json::from_str::<Vec<String>>(&row?) {
                        out.push(tags);
                    }
                }
            }
        }
        Ok(out)
    }
}

/// Vague 10 — vocabulary-coverage breakdown for a language deck.
///
/// Each bucket counts the deck's notes whose `frequency_band` equals the
/// matching Zipf tier; `untagged` collects NULL-band notes (the Pareto long
/// tail still waiting to be classified). The six fields sum to the deck's
/// total note count, so the UI renders a stacked bar without a second query.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct FrequencyCoverage {
    pub top_100: i64,
    pub top_1k: i64,
    pub top_5k: i64,
    pub top_10k: i64,
    pub beyond: i64,
    pub untagged: i64,
}

// ---- helpers ----------------------------------------------------------------

fn row_to_note(row: &Row<'_>) -> rusqlite::Result<AppResult<Note>> {
    let id: i64 = row.get(0)?;
    let deck_id: i64 = row.get(1)?;
    let template_str: String = row.get(2)?;
    let fields_str: String = row.get(3)?;
    let tags_str: String = row.get(4)?;
    let created_at: i64 = row.get(5)?;
    let updated_at: i64 = row.get(6)?;
    let frequency_band: Option<String> = row.get(7)?;

    let parse = || -> AppResult<Note> {
        let template = NoteTemplate::from_str(&template_str)?;
        let fields: serde_json::Value = serde_json::from_str(&fields_str)?;
        let tags: Vec<String> = serde_json::from_str(&tags_str)?;
        Ok(Note {
            id,
            deck_id,
            template,
            fields,
            tags,
            created_at,
            updated_at,
            frequency_band,
        })
    };

    Ok(parse())
}

/// Validate that `fields` carries the keys/values required by `template`.
fn validate_fields(template: NoteTemplate, fields: &serde_json::Value) -> AppResult<()> {
    let obj = fields
        .as_object()
        .ok_or_else(|| AppError::Validation("fields must be a JSON object".into()))?;

    match template {
        NoteTemplate::Basic | NoteTemplate::BasicReverse => {
            for key in ["front", "back"] {
                let v = obj
                    .get(key)
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| AppError::Validation(format!("missing string field '{}'", key)))?;
                if v.trim().is_empty() {
                    return Err(AppError::Validation(format!("field '{}' must not be empty", key)));
                }
            }
        }
        NoteTemplate::Cloze => {
            let text = obj
                .get("text")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::Validation("cloze note requires a 'text' field".into()))?;
            if extract_cloze_ords(text).is_empty() {
                return Err(AppError::Validation(
                    "cloze note 'text' must contain at least one {{cN::...}} marker".into(),
                ));
            }
        }
        NoteTemplate::Occlusion => {
            let image_path = obj
                .get("image_path")
                .and_then(|v| v.as_str())
                .ok_or_else(|| {
                    AppError::Validation("occlusion note requires an 'image_path' string".into())
                })?;
            if image_path.trim().is_empty() {
                return Err(AppError::Validation(
                    "occlusion note 'image_path' must not be empty".into(),
                ));
            }
            let masks = obj
                .get("masks")
                .and_then(|v| v.as_array())
                .ok_or_else(|| {
                    AppError::Validation("occlusion note requires a 'masks' array".into())
                })?;
            if masks.is_empty() {
                return Err(AppError::Validation(
                    "occlusion note must declare at least one mask".into(),
                ));
            }
            for (idx, mask) in masks.iter().enumerate() {
                let m = mask.as_object().ok_or_else(|| {
                    AppError::Validation(format!("mask #{} must be a JSON object", idx))
                })?;
                for key in ["x", "y", "width", "height"] {
                    let v = m.get(key).and_then(|v| v.as_f64()).ok_or_else(|| {
                        AppError::Validation(format!("mask #{} missing numeric '{}'", idx, key))
                    })?;
                    if !v.is_finite() {
                        return Err(AppError::Validation(format!(
                            "mask #{} '{}' must be a finite number",
                            idx, key
                        )));
                    }
                }
                let w = m.get("width").and_then(|v| v.as_f64()).unwrap_or(0.0);
                let h = m.get("height").and_then(|v| v.as_f64()).unwrap_or(0.0);
                if w <= 0.0 || h <= 0.0 {
                    return Err(AppError::Validation(format!(
                        "mask #{} width/height must be > 0",
                        idx
                    )));
                }
            }
        }
        NoteTemplate::Sentence | NoteTemplate::Bidirectional => {
            // Both templates share the same two-string contract. The
            // sentence template additionally accepts optional `notes`,
            // `source_lang`, `target_lang` strings — we don't enforce
            // those because « no notes » and « unknown languages » are
            // both perfectly valid.
            for key in ["source", "target"] {
                let v = obj
                    .get(key)
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| {
                        AppError::Validation(format!("missing string field '{}'", key))
                    })?;
                if v.trim().is_empty() {
                    return Err(AppError::Validation(format!(
                        "field '{}' must not be empty",
                        key
                    )));
                }
            }
            if matches!(template, NoteTemplate::Sentence) {
                for optional_key in ["notes", "source_lang", "target_lang"] {
                    if let Some(value) = obj.get(optional_key) {
                        if !value.is_null() && !value.is_string() {
                            return Err(AppError::Validation(format!(
                                "field '{}' must be a string when present",
                                optional_key
                            )));
                        }
                    }
                }
            }
        }
        NoteTemplate::IllnessScript => {
            // `condition` is the card prompt — required and non-blank.
            let condition = obj
                .get("condition")
                .and_then(|v| v.as_str())
                .ok_or_else(|| {
                    AppError::Validation("illness script requires a 'condition' string".into())
                })?;
            if condition.trim().is_empty() {
                return Err(AppError::Validation(
                    "illness script 'condition' must not be empty".into(),
                ));
            }
            // The four clinical sections are individually optional, but the
            // verso would be empty if none are filled — reject that.
            let sections = ["epidemiology", "pathophysiology", "clinical", "management"];
            for key in sections {
                if let Some(value) = obj.get(key) {
                    if !value.is_null() && !value.is_string() {
                        return Err(AppError::Validation(format!(
                            "field '{}' must be a string when present",
                            key
                        )));
                    }
                }
            }
            let any_section_filled = sections.iter().any(|key| {
                obj.get(*key)
                    .and_then(|v| v.as_str())
                    .map(|s| !s.trim().is_empty())
                    .unwrap_or(false)
            });
            if !any_section_filled {
                return Err(AppError::Validation(
                    "illness script must fill at least one section (epidemiology / \
                     pathophysiology / clinical / management)"
                        .into(),
                ));
            }
        }
        NoteTemplate::Refutation => {
            // Both the misconception and its correction are required — the
            // whole card hinges on the contrast.
            for key in ["misconception", "correct"] {
                let v = obj
                    .get(key)
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| {
                        AppError::Validation(format!("missing string field '{}'", key))
                    })?;
                if v.trim().is_empty() {
                    return Err(AppError::Validation(format!(
                        "field '{}' must not be empty",
                        key
                    )));
                }
            }
            // `explanation` is optional but, if present, must be a string.
            if let Some(value) = obj.get("explanation") {
                if !value.is_null() && !value.is_string() {
                    return Err(AppError::Validation(
                        "field 'explanation' must be a string when present".into(),
                    ));
                }
            }
        }
        NoteTemplate::WorkedExample => {
            // The problem statement (recto) and the final answer are both
            // required and non-blank — the card is meaningless without either.
            for key in ["problem", "answer"] {
                let v = obj
                    .get(key)
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| {
                        AppError::Validation(format!("missing string field '{}'", key))
                    })?;
                if v.trim().is_empty() {
                    return Err(AppError::Validation(format!(
                        "field '{}' must not be empty",
                        key
                    )));
                }
            }
            // `steps` is the faded scaffolding — an array of strings with at
            // least one non-empty entry. Each entry must itself be a string.
            let steps = obj
                .get("steps")
                .and_then(|v| v.as_array())
                .ok_or_else(|| {
                    AppError::Validation("worked example requires a 'steps' array".into())
                })?;
            let non_empty_steps = steps
                .iter()
                .filter(|s| s.as_str().map(|t| !t.trim().is_empty()).unwrap_or(false))
                .count();
            if non_empty_steps == 0 {
                return Err(AppError::Validation(
                    "worked example 'steps' must contain at least one non-empty step".into(),
                ));
            }
            for (idx, step) in steps.iter().enumerate() {
                if !step.is_string() {
                    return Err(AppError::Validation(format!(
                        "step #{} must be a string",
                        idx
                    )));
                }
            }
        }
    }
    Ok(())
}

/// Determine the ordinal list for the cards belonging to a freshly-created note.
fn ords_for_template(
    template: NoteTemplate,
    fields: &serde_json::Value,
) -> AppResult<Vec<i64>> {
    match template {
        NoteTemplate::Basic => Ok(vec![0]),
        NoteTemplate::BasicReverse => Ok(vec![0, 1]),
        NoteTemplate::Cloze => {
            let text = fields
                .get("text")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::Validation("cloze note requires a 'text' field".into()))?;
            let ords = extract_cloze_ords(text);
            if ords.is_empty() {
                return Err(AppError::Validation(
                    "cloze note 'text' must contain at least one {{cN::...}} marker".into(),
                ));
            }
            Ok(ords.into_iter().map(|n| n as i64).collect())
        }
        NoteTemplate::Occlusion => {
            let masks = fields
                .get("masks")
                .and_then(|v| v.as_array())
                .ok_or_else(|| {
                    AppError::Validation("occlusion note requires a 'masks' array".into())
                })?;
            if masks.is_empty() {
                return Err(AppError::Validation(
                    "occlusion note must declare at least one mask".into(),
                ));
            }
            Ok((0..masks.len() as i64).collect())
        }
        // Vague 10 — language-learning templates.
        NoteTemplate::Sentence => Ok(vec![0]),
        NoteTemplate::Bidirectional => Ok(vec![0, 1]),
        // Vague 14 — disciplinary templates, one card each.
        NoteTemplate::IllnessScript => Ok(vec![0]),
        NoteTemplate::Refutation => Ok(vec![0]),
        // Vague 15 — maths worked example, one card.
        NoteTemplate::WorkedExample => Ok(vec![0]),
    }
}

/// Scan a cloze source for `{{cN::...}}` markers and return the sorted, unique
/// list of N values. We hand-roll the parser to avoid pulling regex into the
/// binary just for this.
pub(crate) fn extract_cloze_ords(text: &str) -> Vec<u32> {
    let bytes = text.as_bytes();
    let mut found: BTreeSet<u32> = BTreeSet::new();
    let mut i = 0;
    while i + 4 < bytes.len() {
        // Look for "{{c" prefix.
        if &bytes[i..i + 3] == b"{{c" {
            let mut j = i + 3;
            let mut num = 0u32;
            let mut any_digit = false;
            while j < bytes.len() && bytes[j].is_ascii_digit() {
                num = num.saturating_mul(10).saturating_add((bytes[j] - b'0') as u32);
                any_digit = true;
                j += 1;
            }
            // Must be followed by "::" and then closed by "}}" somewhere later.
            if any_digit && j + 1 < bytes.len() && &bytes[j..j + 2] == b"::" {
                // Find the matching "}}". A nested "{{" inside the answer is unusual
                // so a plain search suffices.
                let mut k = j + 2;
                while k + 1 < bytes.len() && &bytes[k..k + 2] != b"}}" {
                    k += 1;
                }
                if k + 1 < bytes.len() && &bytes[k..k + 2] == b"}}" {
                    found.insert(num);
                    i = k + 2;
                    continue;
                }
            }
        }
        i += 1;
    }
    found.into_iter().collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;
    use serde_json::json;

    #[test]
    fn extract_cloze_ords_finds_unique_sorted() {
        let text = "The {{c1::capital}} of {{c2::France}} is {{c1::Paris}}";
        assert_eq!(extract_cloze_ords(text), vec![1, 2]);
    }

    #[test]
    fn extract_cloze_ords_ignores_plain_braces() {
        assert!(extract_cloze_ords("Just some {text} with no cloze").is_empty());
        assert!(extract_cloze_ords("{{c1::}}").contains(&1));
        assert!(extract_cloze_ords("{{c::wrong}}").is_empty());
    }

    #[test]
    fn occlusion_creates_one_card_per_mask() {
        let db = Database::for_test();
        let conn = db.lock();
        let deck = db
            .decks(&conn)
            .create("Bio", None, "#3b82f6", 0.9, None, None, None)
            .unwrap();

        let fields = json!({
            "image_path": "/tmp/cell.png",
            "natural_width": 800,
            "natural_height": 600,
            "masks": [
                { "x": 10.0, "y": 20.0, "width": 100.0, "height": 50.0, "label": "Mitochondrie" },
                { "x": 200.0, "y": 80.0, "width": 80.0, "height": 80.0, "label": "Noyau" },
                { "x": 300.0, "y": 200.0, "width": 60.0, "height": 60.0, "label": "" }
            ]
        });

        let note = db
            .notes(&conn)
            .create(deck.id, NoteTemplate::Occlusion, fields, vec![], None)
            .expect("note creation");
        assert_eq!(note.template, NoteTemplate::Occlusion);

        // 3 masks → 3 cards with ords 0, 1, 2.
        let card_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM cards WHERE note_id = ?1",
                rusqlite::params![note.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(card_count, 3);

        let ords: Vec<i64> = {
            let mut stmt = conn
                .prepare(
                    "SELECT card_ord FROM cards WHERE note_id = ?1 ORDER BY card_ord ASC",
                )
                .unwrap();
            stmt.query_map(rusqlite::params![note.id], |r| r.get::<_, i64>(0))
                .unwrap()
                .map(|r| r.unwrap())
                .collect()
        };
        assert_eq!(ords, vec![0, 1, 2]);
    }

    #[test]
    fn occlusion_rejects_empty_masks() {
        let db = Database::for_test();
        let conn = db.lock();
        let deck = db.decks(&conn).create("X", None, "#3b82f6", 0.9, None, None, None).unwrap();

        let err = db
            .notes(&conn)
            .create(
                deck.id,
                NoteTemplate::Occlusion,
                json!({
                    "image_path": "/tmp/x.png",
                    "natural_width": 1,
                    "natural_height": 1,
                    "masks": []
                }),
                vec![],
                None,
            )
            .unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
    }

    #[test]
    fn occlusion_rejects_missing_image_path() {
        let db = Database::for_test();
        let conn = db.lock();
        let deck = db.decks(&conn).create("Y", None, "#3b82f6", 0.9, None, None, None).unwrap();

        let err = db
            .notes(&conn)
            .create(
                deck.id,
                NoteTemplate::Occlusion,
                json!({
                    "masks": [{ "x": 1.0, "y": 1.0, "width": 10.0, "height": 10.0 }]
                }),
                vec![],
                None,
            )
            .unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
    }

    #[test]
    fn create_worked_example_creates_1_card() {
        let db = Database::for_test();
        let conn = db.lock();
        let deck = db
            .decks(&conn)
            .create("Maths", None, "#3b82f6", 0.9, None, None, None)
            .unwrap();

        let fields = json!({
            "problem": "Résoudre 2x + 3 = 11",
            "steps": ["Soustraire 3 : 2x = 8", "Diviser par 2 : x = 4"],
            "answer": "x = 4"
        });

        let note = db
            .notes(&conn)
            .create(deck.id, NoteTemplate::WorkedExample, fields, vec![], None)
            .expect("worked example note creation");
        assert_eq!(note.template, NoteTemplate::WorkedExample);

        // Exactly one card with ord 0.
        let card_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM cards WHERE note_id = ?1",
                rusqlite::params![note.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(card_count, 1);
    }

    #[test]
    fn worked_example_requires_problem_and_answer() {
        let db = Database::for_test();
        let conn = db.lock();
        let deck = db
            .decks(&conn)
            .create("Maths", None, "#3b82f6", 0.9, None, None, None)
            .unwrap();

        // Missing `answer`.
        let err = db
            .notes(&conn)
            .create(
                deck.id,
                NoteTemplate::WorkedExample,
                json!({ "problem": "2x = 4", "steps": ["x = 2"] }),
                vec![],
                None,
            )
            .unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));

        // Empty `problem`.
        let err = db
            .notes(&conn)
            .create(
                deck.id,
                NoteTemplate::WorkedExample,
                json!({ "problem": "  ", "steps": ["x = 2"], "answer": "x = 2" }),
                vec![],
                None,
            )
            .unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));

        // No non-empty steps.
        let err = db
            .notes(&conn)
            .create(
                deck.id,
                NoteTemplate::WorkedExample,
                json!({ "problem": "2x = 4", "steps": ["", "  "], "answer": "x = 2" }),
                vec![],
                None,
            )
            .unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
    }
}
