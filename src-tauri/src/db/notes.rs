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

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

use crate::error::{AppError, AppResult};

use super::cards::CardRepo;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NoteTemplate {
    Basic,
    BasicReverse,
    Cloze,
}

impl NoteTemplate {
    pub fn as_str(self) -> &'static str {
        match self {
            NoteTemplate::Basic => "basic",
            NoteTemplate::BasicReverse => "basic_reverse",
            NoteTemplate::Cloze => "cloze",
        }
    }

    pub fn from_str(s: &str) -> AppResult<Self> {
        match s {
            "basic" => Ok(NoteTemplate::Basic),
            "basic_reverse" => Ok(NoteTemplate::BasicReverse),
            "cloze" => Ok(NoteTemplate::Cloze),
            other => Err(AppError::Database(format!(
                "invalid note template '{}'",
                other
            ))),
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
            "SELECT id, deck_id, template, fields, tags, created_at, updated_at
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
                "SELECT id, deck_id, template, fields, tags, created_at, updated_at
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
    /// - `Basic`        → 1 card (ord=0)
    /// - `BasicReverse` → 2 cards (ord=0 front→back, ord=1 back→front)
    /// - `Cloze`        → one card per unique `{{cN::…}}` index found in the
    ///   `text` field; if no cloze is found, returns a `Validation` error.
    pub fn create(
        &self,
        deck_id: i64,
        template: NoteTemplate,
        fields: serde_json::Value,
        tags: Vec<String>,
    ) -> AppResult<Note> {
        validate_fields(template, &fields)?;

        let now = Utc::now().timestamp();
        let fields_str = serde_json::to_string(&fields)?;
        let tags_str = serde_json::to_string(&tags)?;

        // Manual transaction: the borrow checker doesn't let us hand out
        // both an &Connection (for CardRepo) and a Transaction at once on
        // rusqlite 0.39, so we drive BEGIN/COMMIT directly. Any error path
        // performs a best-effort ROLLBACK before bubbling up.
        self.conn.execute_batch("BEGIN;")?;

        let insert_res = self.conn.execute(
            "INSERT INTO notes (deck_id, template, fields, tags, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
            params![deck_id, template.as_str(), fields_str, tags_str, now],
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
            "SELECT n.id, n.deck_id, n.template, n.fields, n.tags, n.created_at, n.updated_at
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

    #[test]
    fn extract_cloze_ords_finds_unique_sorted() {
        let text = "The {{c1::capital}} of {{c2::France}} is {{c1::Paris}}";
        assert_eq!(extract_cloze_ords(text), vec![1, 2]);
    }

    #[test]
    fn extract_cloze_ords_ignores_plain_braces() {
        assert!(extract_cloze_ords("Just some {text} with no cloze").is_empty());
        assert!(extract_cloze_ords("{{c1::}}").iter().any(|&n| n == 1));
        assert!(extract_cloze_ords("{{c::wrong}}").is_empty());
    }
}
