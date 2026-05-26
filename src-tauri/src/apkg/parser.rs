//! Low-level `.apkg` parser.
//!
//! Owns the ZIP extraction and the SQLite read pass. The output is a fully
//! deserialised [`AnkiCollection`] — pure data, no I/O side-effects beyond
//! the temp file rusqlite needs to open the SQLite DB.

use std::collections::HashMap;
use std::io::Read;
use std::path::PathBuf;

use rusqlite::Connection;
use serde::Serialize;
use serde_json::Value;

use crate::error::{AppError, AppResult};

/// Fully-decoded Anki collection. All four vectors are deck/model/note/card
/// rows verbatim (no Mnemosys-side mapping yet) — `convert_to_mnemosys`
/// translates this into our schema.
#[derive(Debug, Clone, Serialize)]
pub struct AnkiCollection {
    pub decks: Vec<AnkiDeck>,
    pub models: Vec<AnkiModel>,
    pub notes: Vec<AnkiNote>,
    pub cards: Vec<AnkiCard>,
    /// Numeric blob name (`"0"`, `"1"`, …) → original filename.
    /// Empty if the `.apkg` had no `media` JSON manifest.
    pub media: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AnkiDeck {
    pub id: i64,
    pub name: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AnkiModel {
    pub id: i64,
    pub name: String,
    /// Ordered field names declared by this model. The Nth entry maps to the
    /// Nth `\x1f`-separated value in [`AnkiNote::fields`].
    pub fields: Vec<String>,
    /// Anki "type": `0` = standard, `1` = cloze.
    pub is_cloze: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct AnkiNote {
    pub id: i64,
    pub model_id: i64,
    /// Field values in model-declared order (parsed from the `\x1f`-joined
    /// `flds` column).
    pub fields: Vec<String>,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AnkiCard {
    pub id: i64,
    pub note_id: i64,
    pub deck_id: i64,
    /// Template ordinal — which card variant within the parent note.
    pub ord: i64,
}

/// Parse a `.apkg` from raw bytes.
///
/// Errors:
/// - `Validation` if the input isn't a ZIP, or uses the unsupported
///   `collection.anki21b` zstd-compressed container.
/// - `Database` if the embedded SQLite is corrupt.
pub fn parse_apkg(bytes: &[u8]) -> AppResult<AnkiCollection> {
    let cursor = std::io::Cursor::new(bytes);
    let mut zip = zip::ZipArchive::new(cursor)
        .map_err(|e| AppError::Validation(format!("Invalid .apkg (not a zip): {e}")))?;

    // Anki has shipped three container variants. We only support the two
    // legacy ones (plain SQLite); the modern zstd-compressed `anki21b`
    // form requires the user to re-export in compat mode.
    if zip_contains(&mut zip, "collection.anki21b") {
        return Err(AppError::Validation(
            "This .apkg uses Anki's newer zstd-compressed `collection.anki21b` format which \
             is not yet supported. Re-export from Anki with 'Support older Anki versions' \
             enabled."
                .to_string(),
        ));
    }
    let collection_filename = if zip_contains(&mut zip, "collection.anki21") {
        "collection.anki21"
    } else if zip_contains(&mut zip, "collection.anki2") {
        "collection.anki2"
    } else {
        return Err(AppError::Validation(
            "No `collection.anki2` found inside .apkg — file may be corrupt.".to_string(),
        ));
    };

    // rusqlite can't open a SQLite DB from a `&[u8]` cursor, so we spill the
    // compressed entry to a temp file. A unique directory name avoids races
    // between concurrent imports.
    let tmp_dir = std::env::temp_dir().join(format!("mnemosys_apkg_{}", unique_suffix()));
    std::fs::create_dir_all(&tmp_dir)?;
    let collection_path = tmp_dir.join("collection.db");
    extract_to_path(&mut zip, collection_filename, &collection_path)?;

    // Optional `media` JSON manifest. Absent on some hand-crafted decks.
    let media = read_media_manifest(&mut zip)?;

    let result = (|| -> AppResult<AnkiCollection> {
        let conn = Connection::open(&collection_path)?;

        let (decks_json, models_json): (String, String) = conn
            .query_row(
                "SELECT decks, models FROM col LIMIT 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|e| AppError::Database(format!("read col row: {e}")))?;

        let decks = parse_decks_json(&decks_json)?;
        let models = parse_models_json(&models_json)?;

        let notes = read_notes(&conn)?;
        let cards = read_cards(&conn)?;

        drop(conn);
        Ok(AnkiCollection {
            decks,
            models,
            notes,
            cards,
            media,
        })
    })();

    // Best-effort cleanup — never fails the import.
    let _ = std::fs::remove_dir_all(&tmp_dir);

    result
}

// -- helpers -----------------------------------------------------------------

/// `ZipArchive::by_name` consumes a `&mut` borrow; this wraps it so we can
/// ask "does X exist?" without holding onto the file handle.
fn zip_contains<R: std::io::Read + std::io::Seek>(
    zip: &mut zip::ZipArchive<R>,
    name: &str,
) -> bool {
    zip.by_name(name).is_ok()
}

fn extract_to_path<R: std::io::Read + std::io::Seek>(
    zip: &mut zip::ZipArchive<R>,
    name: &str,
    out: &PathBuf,
) -> AppResult<()> {
    let mut entry = zip
        .by_name(name)
        .map_err(|e| AppError::Validation(format!("missing `{name}` in .apkg: {e}")))?;
    let mut file = std::fs::File::create(out)?;
    std::io::copy(&mut entry, &mut file)?;
    Ok(())
}

fn read_media_manifest<R: std::io::Read + std::io::Seek>(
    zip: &mut zip::ZipArchive<R>,
) -> AppResult<HashMap<String, String>> {
    let mut out = HashMap::new();
    let mut text = String::new();
    {
        let mut entry = match zip.by_name("media") {
            Ok(e) => e,
            Err(_) => return Ok(out),
        };
        entry.read_to_string(&mut text)?;
    }
    if text.trim().is_empty() {
        return Ok(out);
    }
    let parsed: serde_json::Map<String, Value> = serde_json::from_str(&text)
        .map_err(|e| AppError::Validation(format!("invalid `media` JSON: {e}")))?;
    for (k, v) in parsed {
        if let Some(filename) = v.as_str() {
            out.insert(k, filename.to_string());
        }
    }
    Ok(out)
}

fn read_notes(conn: &Connection) -> AppResult<Vec<AnkiNote>> {
    let mut stmt = conn.prepare("SELECT id, mid, flds, tags FROM notes")?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
        ))
    })?;

    let mut out = Vec::new();
    for row in rows {
        let (id, mid, flds, tags) = row?;
        let fields: Vec<String> = flds.split('\x1f').map(String::from).collect();
        let tags: Vec<String> = tags
            .split_whitespace()
            .map(String::from)
            .collect();
        out.push(AnkiNote {
            id,
            model_id: mid,
            fields,
            tags,
        });
    }
    Ok(out)
}

fn read_cards(conn: &Connection) -> AppResult<Vec<AnkiCard>> {
    let mut stmt = conn.prepare("SELECT id, nid, did, ord FROM cards")?;
    let rows = stmt.query_map([], |row| {
        Ok(AnkiCard {
            id: row.get(0)?,
            note_id: row.get(1)?,
            deck_id: row.get(2)?,
            ord: row.get(3)?,
        })
    })?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// Parse the `col.decks` JSON blob — keyed by stringified deck id.
pub(crate) fn parse_decks_json(json: &str) -> AppResult<Vec<AnkiDeck>> {
    let parsed: serde_json::Map<String, Value> = serde_json::from_str(json)
        .map_err(|e| AppError::Validation(format!("invalid `decks` JSON: {e}")))?;
    Ok(parsed
        .into_iter()
        .filter_map(|(id_str, v)| {
            let id = id_str.parse::<i64>().ok()?;
            let name = v.get("name")?.as_str()?.to_string();
            let description = v.get("desc").and_then(|d| d.as_str()).map(String::from);
            Some(AnkiDeck {
                id,
                name,
                description,
            })
        })
        .collect())
}

/// Parse the `col.models` JSON blob — keyed by stringified model id.
pub(crate) fn parse_models_json(json: &str) -> AppResult<Vec<AnkiModel>> {
    let parsed: serde_json::Map<String, Value> = serde_json::from_str(json)
        .map_err(|e| AppError::Validation(format!("invalid `models` JSON: {e}")))?;
    Ok(parsed
        .into_iter()
        .filter_map(|(id_str, v)| {
            let id = id_str.parse::<i64>().ok()?;
            let name = v.get("name")?.as_str()?.to_string();
            let fields = v
                .get("flds")?
                .as_array()?
                .iter()
                .filter_map(|f| f.get("name").and_then(|n| n.as_str()).map(String::from))
                .collect();
            let is_cloze = v
                .get("type")
                .and_then(|t| t.as_i64())
                .map(|t| t == 1)
                .unwrap_or(false);
            Some(AnkiModel {
                id,
                name,
                fields,
                is_cloze,
            })
        })
        .collect())
}

/// Unique-enough suffix for the temp-dir name. We don't need true UUID
/// strength — collisions only matter between simultaneous imports.
fn unique_suffix() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{nanos}_{}", std::process::id())
}
