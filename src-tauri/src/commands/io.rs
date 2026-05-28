//! Import / export commands for the Mnemosys collection.
//!
//! Wave C2 — JSON round-trip only. The `.apkg` (Anki package) importer is
//! deferred to Session 2 and not implemented here.
//!
//! Export format (versioned, forward-compatible)
//! ---------------------------------------------
//! ```jsonc
//! {
//!   "version": 1,
//!   "exported_at": 1716_700_000_000,   // unix millis, informational only
//!   "app": "Mnemosys",
//!   "decks": [
//!     {
//!       "name": "Spanish",
//!       "description": "Common verbs",
//!       "color": "#3b82f6",
//!       "desired_retention": 0.9,
//!       "notes": [
//!         { "template": "basic", "fields": { "front": "...", "back": "..." }, "tags": [] }
//!       ]
//!     }
//!   ]
//! }
//! ```
//!
//! Scheduling state (FSRS stability / difficulty, review history) is **not**
//! exported. The importer rebuilds fresh `new` cards from each note, exactly
//! as if the user had typed them by hand. This keeps the format portable
//! between databases at the cost of losing per-card history — an explicit
//! design choice for the Session 1 MVP.

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::app_state::AppState;
use crate::db::{Database, NoteTemplate};
use crate::error::{AppError, AppResult};

/// Top-level envelope written to disk. The `version` field lets future
/// importers detect and gracefully reject newer payloads.
#[derive(Debug, Serialize, Deserialize)]
pub struct ExportFile {
    pub version: u32,
    pub exported_at: i64,
    pub app: String,
    pub decks: Vec<ExportDeck>,
}

/// One deck plus all its notes. Deck `id` / timestamps are omitted on
/// purpose — the importer mints fresh rows.
#[derive(Debug, Serialize, Deserialize)]
pub struct ExportDeck {
    pub name: String,
    pub description: Option<String>,
    pub color: String,
    pub desired_retention: f64,
    pub notes: Vec<ExportNote>,
}

/// One note in the export — template, raw fields and tags. Vague 10 adds
/// `frequency_band` (optional) so language-learning frequency tags
/// round-trip through JSON exports. The field is `#[serde(default)]` so
/// older pre-v10 export files (which don't carry the key) still import.
#[derive(Debug, Serialize, Deserialize)]
pub struct ExportNote {
    pub template: NoteTemplate,
    pub fields: serde_json::Value,
    pub tags: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub frequency_band: Option<String>,
}

/// Per-import summary returned to the frontend so it can render a toast.
#[derive(Debug, Serialize, Deserialize)]
pub struct ImportResult {
    pub decks_imported: usize,
    pub notes_imported: usize,
    pub cards_created: usize,
    /// Decks skipped because a deck with the same name already exists.
    /// Conflict resolution is intentionally simple for MVP — duplicate
    /// names are silently skipped and reported back to the user.
    pub skipped_decks: Vec<String>,
}

/// Largest plausible deck size we'll fetch in a single call. SQLite handles
/// this fine and avoids paginating in the export path.
const MAX_NOTES_PER_DECK: u32 = 100_000;

/// Build the export envelope from a `Database` handle. Pure DB logic — no
/// `tauri::State` or filesystem access — so it's directly unit-testable.
pub fn build_export(db: &Database, deck_ids: &[i64]) -> AppResult<ExportFile> {
    if deck_ids.is_empty() {
        return Err(AppError::Validation("deck_ids must not be empty".into()));
    }

    let conn = db.lock();
    let mut export_decks = Vec::with_capacity(deck_ids.len());

    for &deck_id in deck_ids {
        let deck = db.decks(&conn).get(deck_id)?;
        let notes = db
            .notes(&conn)
            .list_in_deck(deck_id, MAX_NOTES_PER_DECK, 0)?;

        let export_notes = notes
            .into_iter()
            .map(|n| ExportNote {
                template: n.template,
                fields: n.fields,
                tags: n.tags,
                frequency_band: n.frequency_band,
            })
            .collect::<Vec<_>>();

        export_decks.push(ExportDeck {
            name: deck.name,
            description: deck.description,
            color: deck.color,
            desired_retention: deck.desired_retention,
            notes: export_notes,
        });
    }

    Ok(ExportFile {
        version: 1,
        exported_at: chrono::Utc::now().timestamp_millis(),
        app: "Mnemosys".to_string(),
        decks: export_decks,
    })
}

/// Serialise the requested decks (and all their notes) as JSON at `path`.
///
/// Returns the total number of notes written so the caller can show
/// "N notes exported" without re-reading the file. The file is written
/// pretty-printed for human inspection.
#[tauri::command]
pub fn export_json(
    state: State<'_, AppState>,
    deck_ids: Vec<i64>,
    path: String,
) -> AppResult<usize> {
    let export = build_export(&state.db, &deck_ids)?;
    let total_notes: usize = export.decks.iter().map(|d| d.notes.len()).sum();
    let json = serde_json::to_string_pretty(&export)?;
    std::fs::write(&path, json)?;
    Ok(total_notes)
}

/// Ingest a deserialised `ExportFile` into the live DB. Pure DB logic — no
/// `tauri::State` or filesystem access — so it's directly unit-testable.
///
/// Conflict policy: decks whose `name` already exists are skipped wholesale
/// (their notes are *not* merged into the existing deck). The skipped names
/// are returned so the UI can surface them.
pub fn apply_import(db: &Database, import: ExportFile) -> AppResult<ImportResult> {
    if import.version != 1 {
        return Err(AppError::Validation(format!(
            "Unsupported Mnemosys export version: {}",
            import.version
        )));
    }
    if import.app != "Mnemosys" {
        return Err(AppError::Validation(format!(
            "Unexpected app marker '{}': not a Mnemosys export",
            import.app
        )));
    }

    let conn = db.lock();
    let existing_names: std::collections::HashSet<String> = db
        .decks(&conn)
        .list()?
        .into_iter()
        .map(|d| d.name)
        .collect();

    let mut decks_imported = 0usize;
    let mut notes_imported = 0usize;
    let mut cards_created = 0usize;
    let mut skipped_decks: Vec<String> = Vec::new();

    for deck_data in import.decks {
        if existing_names.contains(&deck_data.name) {
            skipped_decks.push(deck_data.name);
            continue;
        }

        let deck = db.decks(&conn).create(
            &deck_data.name,
            deck_data.description.as_deref(),
            &deck_data.color,
            deck_data.desired_retention,
            None,
            None,
            None,
        )?;

        let card_count_before: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM cards WHERE deck_id = ?1",
                rusqlite::params![deck.id],
                |r| r.get(0),
            )
            .unwrap_or(0);

        for note in deck_data.notes {
            // NoteRepo::create also materialises every derived card row, so
            // we don't need a separate card-count pass per template.
            db.notes(&conn).create(
                deck.id,
                note.template,
                note.fields,
                note.tags,
                note.frequency_band,
            )?;
            notes_imported += 1;
        }

        let card_count_after: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM cards WHERE deck_id = ?1",
                rusqlite::params![deck.id],
                |r| r.get(0),
            )
            .unwrap_or(0);
        cards_created += (card_count_after - card_count_before).max(0) as usize;

        decks_imported += 1;
    }

    Ok(ImportResult {
        decks_imported,
        notes_imported,
        cards_created,
        skipped_decks,
    })
}

/// Read a Mnemosys JSON export from `path` and ingest it into the live DB.
#[tauri::command]
pub fn import_json(state: State<'_, AppState>, path: String) -> AppResult<ImportResult> {
    let content = std::fs::read_to_string(&path)?;
    let import: ExportFile = serde_json::from_str(&content)
        .map_err(|e| AppError::Validation(format!("Invalid Mnemosys JSON: {}", e)))?;
    apply_import(&state.db, import)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{Database, NoteTemplate};
    use serde_json::json;

    fn seed_db_with_two_decks() -> Database {
        let db = Database::for_test();
        let conn = db.lock();
        let deck_a = db
            .decks(&conn)
            .create("Spanish", Some("vocab"), "#3b82f6", 0.9, None, None, None)
            .unwrap();
        db.notes(&conn)
            .create(
                deck_a.id,
                NoteTemplate::Basic,
                json!({ "front": "hola", "back": "hello" }),
                vec!["greeting".to_string()],
                None,
            )
            .unwrap();
        db.notes(&conn)
            .create(
                deck_a.id,
                NoteTemplate::BasicReverse,
                json!({ "front": "adios", "back": "goodbye" }),
                vec![],
                None,
            )
            .unwrap();

        let deck_b = db
            .decks(&conn)
            .create("Capitals", None, "#ef4444", 0.92, None, None, None)
            .unwrap();
        db.notes(&conn)
            .create(
                deck_b.id,
                NoteTemplate::Cloze,
                json!({ "text": "The capital of {{c1::France}} is {{c2::Paris}}" }),
                vec!["geo".to_string()],
                None,
            )
            .unwrap();
        drop(conn);
        db
    }

    #[test]
    fn export_envelope_contains_all_notes() {
        let db = seed_db_with_two_decks();
        let deck_ids: Vec<i64> = {
            let conn = db.lock();
            db.decks(&conn)
                .list()
                .unwrap()
                .iter()
                .map(|d| d.id)
                .collect()
        };

        let export = build_export(&db, &deck_ids).unwrap();
        assert_eq!(export.version, 1);
        assert_eq!(export.app, "Mnemosys");
        assert_eq!(export.decks.len(), 2);

        let total_notes: usize = export.decks.iter().map(|d| d.notes.len()).sum();
        assert_eq!(total_notes, 3);
    }

    #[test]
    fn export_rejects_empty_deck_ids() {
        let db = Database::for_test();
        let err = build_export(&db, &[]).unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
    }

    #[test]
    fn round_trip_preserves_decks_and_notes() {
        let src_db = seed_db_with_two_decks();
        let deck_ids: Vec<i64> = {
            let conn = src_db.lock();
            src_db
                .decks(&conn)
                .list()
                .unwrap()
                .iter()
                .map(|d| d.id)
                .collect()
        };
        let export = build_export(&src_db, &deck_ids).unwrap();

        // Serialise + deserialise to mirror the disk round-trip.
        let json = serde_json::to_string(&export).unwrap();
        let parsed: ExportFile = serde_json::from_str(&json).unwrap();

        let dst_db = Database::for_test();
        let report = apply_import(&dst_db, parsed).unwrap();

        assert_eq!(report.decks_imported, 2);
        assert_eq!(report.notes_imported, 3);
        // 1 basic + 2 basic_reverse + 2 cloze cards = 5
        assert_eq!(report.cards_created, 5);
        assert!(report.skipped_decks.is_empty());

        let conn = dst_db.lock();
        let decks = dst_db.decks(&conn).list().unwrap();
        let names: Vec<&str> = decks.iter().map(|d| d.name.as_str()).collect();
        assert!(names.contains(&"Spanish"));
        assert!(names.contains(&"Capitals"));
    }

    #[test]
    fn import_skips_existing_deck_names() {
        let dst_db = Database::for_test();
        {
            let conn = dst_db.lock();
            dst_db
                .decks(&conn)
                .create("Spanish", None, "#3b82f6", 0.9, None, None, None)
                .unwrap();
        }

        let src_db = seed_db_with_two_decks();
        let deck_ids: Vec<i64> = {
            let conn = src_db.lock();
            src_db
                .decks(&conn)
                .list()
                .unwrap()
                .iter()
                .map(|d| d.id)
                .collect()
        };
        let export = build_export(&src_db, &deck_ids).unwrap();
        let report = apply_import(&dst_db, export).unwrap();

        assert_eq!(report.decks_imported, 1, "only 'Capitals' should land");
        assert_eq!(report.skipped_decks, vec!["Spanish".to_string()]);
    }

    #[test]
    fn import_rejects_unknown_version() {
        let db = Database::for_test();
        let bad = ExportFile {
            version: 99,
            exported_at: 0,
            app: "Mnemosys".into(),
            decks: vec![],
        };
        let err = apply_import(&db, bad).unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
    }

    #[test]
    fn import_rejects_unknown_app_marker() {
        let db = Database::for_test();
        let bad = ExportFile {
            version: 1,
            exported_at: 0,
            app: "Anki".into(),
            decks: vec![],
        };
        let err = apply_import(&db, bad).unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
    }
}
