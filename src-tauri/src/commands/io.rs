//! Import / export commands for the Mnemosys collection.
//!
//! Wave C2 — JSON round-trip only. The `.apkg` (Anki package) importer is
//! deferred to Session 2 and not implemented here.
//!
//! Export format (versioned, forward-compatible)
//! ---------------------------------------------
//! ```jsonc
//! {
//!   "version": 2,
//!   "exported_at": 1716_700_000_000,   // unix millis, informational only
//!   "app": "Mnemosys",
//!   "decks": [
//!     {
//!       "name": "Spanish",
//!       "description": "Common verbs",
//!       "color": "#3b82f6",
//!       "desired_retention": 0.9,
//!       "notes": [
//!         {
//!           "template": "basic",
//!           "fields": { "front": "...", "back": "..." },
//!           "tags": [],
//!           // v2 — full FSRS scheduling state, one entry per derived card,
//!           // ordered by card_ord. Timestamps are unix seconds.
//!           "cards": [
//!             { "card_ord": 0, "state": "review", "stability": 12.5,
//!               "difficulty": 5.2, "last_review": 1716000000,
//!               "next_review": 1717036800, "elapsed_days": 3,
//!               "scheduled_days": 12, "reps": 7, "lapses": 1,
//!               "suspended": false }
//!           ]
//!         }
//!       ],
//!       // v2 — the deck's full review log, oldest first. `card_index` is the
//!       // position of the card in THIS deck's export (notes in file order,
//!       // each note's cards in file order) — NOT a database id, so the file
//!       // stays portable between databases.
//!       "reviews": [
//!         { "card_index": 0, "rating": 3, "state_before": "new",
//!           "state_after": "review", "stability_before": null,
//!           "stability_after": 5.0, "difficulty_before": null,
//!           "difficulty_after": 5.2, "elapsed_days": 0,
//!           "scheduled_days": 5, "review_time": 4200,
//!           "reviewed_at": 1716000000, "confidence": 4 }
//!       ]
//!     }
//!   ]
//! }
//! ```
//!
//! Version history
//! ---------------
//! - **v1** (Session 1 MVP): decks + notes only. The importer rebuilds fresh
//!   `new` cards from each note, exactly as if the user had typed them by
//!   hand — scheduling state and review history are lost.
//! - **v2**: adds `notes[].cards` (per-card FSRS state: state / stability /
//!   difficulty / next_review / reps / lapses / …) and `decks[].reviews` (the
//!   append-only review log), so restoring a backup preserves the learner's
//!   progress and keeps the FSRS optimizer's training data. v1 files — and
//!   files with no `version` field at all — still import exactly as before:
//!   content only, fresh `new` cards.

use std::collections::HashMap;
use std::str::FromStr;

use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::app_state::AppState;
use crate::db::{CardState, Database, NewReview, NoteTemplate};
use crate::error::{AppError, AppResult};

/// Schema version written by [`build_export`]. The importer accepts every
/// version in `1..=EXPORT_VERSION` and rejects anything newer.
const EXPORT_VERSION: u32 = 2;

/// Serde fallback for [`ExportFile::version`]: a payload with no `version`
/// key is treated as the original v1 schema (content only).
fn default_export_version() -> u32 {
    1
}

/// Top-level envelope written to disk. The `version` field lets future
/// importers detect and gracefully reject newer payloads.
#[derive(Debug, Serialize, Deserialize)]
pub struct ExportFile {
    #[serde(default = "default_export_version")]
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
    /// v2 — the deck's review log, oldest first. Empty (and omitted from the
    /// JSON) for never-reviewed decks; `#[serde(default)]` keeps v1 files
    /// (which don't carry the key) parseable.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub reviews: Vec<ExportReview>,
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
    /// v2 — full scheduling state of every card derived from this note,
    /// ordered by `card_ord`. `#[serde(default)]` keeps v1 files parseable;
    /// the importer ignores the section entirely for `version: 1` payloads.
    #[serde(default)]
    pub cards: Vec<ExportCard>,
}

/// v2 — the complete FSRS scheduling state of one card, restored verbatim on
/// import. Mirrors the `cards` table minus ids/timestamps (the importer mints
/// fresh rows and re-links by `card_ord` within the parent note).
#[derive(Debug, Serialize, Deserialize)]
pub struct ExportCard {
    pub card_ord: i64,
    pub state: CardState,
    pub stability: Option<f64>,
    pub difficulty: Option<f64>,
    pub last_review: Option<i64>,
    pub next_review: Option<i64>,
    pub elapsed_days: i64,
    pub scheduled_days: i64,
    pub reps: i64,
    pub lapses: i64,
    pub suspended: bool,
}

/// v2 — one row of the append-only review log. The card is identified by
/// `card_index`: its position in the deck's exported card sequence (notes in
/// file order, each note's cards in file order), which the importer maps back
/// to the freshly-minted card ids.
#[derive(Debug, Serialize, Deserialize)]
pub struct ExportReview {
    pub card_index: usize,
    pub rating: i64,
    pub state_before: CardState,
    pub state_after: CardState,
    pub stability_before: Option<f64>,
    pub stability_after: f64,
    pub difficulty_before: Option<f64>,
    pub difficulty_after: f64,
    pub elapsed_days: i64,
    pub scheduled_days: i64,
    pub review_time: i64,
    pub reviewed_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub confidence: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub confidence_post: Option<i64>,
}

/// Per-import summary returned to the frontend so it can render a toast.
#[derive(Debug, Serialize, Deserialize)]
pub struct ImportResult {
    pub decks_imported: usize,
    pub notes_imported: usize,
    pub cards_created: usize,
    /// v2 — review-log rows restored. Always 0 for v1 payloads.
    #[serde(default)]
    pub reviews_imported: usize,
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

        // v2 — every card in the deck with its full scheduling state, grouped
        // by parent note (card_ord ASC within a note).
        let mut cards_by_note = collect_deck_cards(&conn, deck_id)?;

        // Flat card numbering in file order: notes in export order, each
        // note's cards in card_ord order. `reviews[].card_index` points into
        // this sequence so the importer can re-link the review log without
        // leaking database ids into the file.
        let mut index_by_card_id: HashMap<i64, usize> = HashMap::new();
        let mut export_notes = Vec::with_capacity(notes.len());
        for n in notes {
            let note_cards = cards_by_note.remove(&n.id).unwrap_or_default();
            let mut cards = Vec::with_capacity(note_cards.len());
            for (card_id, card) in note_cards {
                index_by_card_id.insert(card_id, index_by_card_id.len());
                cards.push(card);
            }
            export_notes.push(ExportNote {
                template: n.template,
                fields: n.fields,
                tags: n.tags,
                frequency_band: n.frequency_band,
                cards,
            });
        }

        let reviews = collect_deck_reviews(&conn, deck_id, &index_by_card_id)?;

        export_decks.push(ExportDeck {
            name: deck.name,
            description: deck.description,
            color: deck.color,
            desired_retention: deck.desired_retention,
            notes: export_notes,
            reviews,
        });
    }

    Ok(ExportFile {
        version: EXPORT_VERSION,
        exported_at: chrono::Utc::now().timestamp_millis(),
        app: "Mnemosys".to_string(),
        decks: export_decks,
    })
}

/// Map a TEXT state column to [`CardState`], surfacing corruption as the
/// usual rusqlite conversion error (same pattern as `db::cards::row_to_card`).
fn state_from_sql(idx: usize, s: &str) -> rusqlite::Result<CardState> {
    CardState::from_str(s).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(
            idx,
            rusqlite::types::Type::Text,
            Box::new(std::io::Error::other(e.to_string())),
        )
    })
}

/// Fetch every card of `deck_id` with its full scheduling state, grouped by
/// parent note id. Within a note the cards arrive in `card_ord` order, which
/// is also the order they're written to the file (and the order the importer
/// walks them back).
fn collect_deck_cards(
    conn: &Connection,
    deck_id: i64,
) -> AppResult<HashMap<i64, Vec<(i64, ExportCard)>>> {
    let mut stmt = conn.prepare(
        "SELECT note_id, id, card_ord, state, stability, difficulty,
                last_review, next_review, elapsed_days, scheduled_days,
                reps, lapses, suspended
         FROM cards
         WHERE deck_id = ?1
         ORDER BY note_id ASC, card_ord ASC",
    )?;
    let rows = stmt.query_map(rusqlite::params![deck_id], |row| {
        let state_str: String = row.get(3)?;
        let state = state_from_sql(3, &state_str)?;
        let suspended_int: i64 = row.get(12)?;
        Ok((
            row.get::<_, i64>(0)?, // note_id
            row.get::<_, i64>(1)?, // card id
            ExportCard {
                card_ord: row.get(2)?,
                state,
                stability: row.get(4)?,
                difficulty: row.get(5)?,
                last_review: row.get(6)?,
                next_review: row.get(7)?,
                elapsed_days: row.get(8)?,
                scheduled_days: row.get(9)?,
                reps: row.get(10)?,
                lapses: row.get(11)?,
                suspended: suspended_int != 0,
            },
        ))
    })?;

    let mut by_note: HashMap<i64, Vec<(i64, ExportCard)>> = HashMap::new();
    for r in rows {
        let (note_id, card_id, card) = r?;
        by_note.entry(note_id).or_default().push((card_id, card));
    }
    Ok(by_note)
}

/// Fetch the deck's review log (oldest first) and translate each `card_id`
/// into its flat `card_index` within the export. Reviews whose card isn't in
/// `index_by_card_id` (a note beyond the [`MAX_NOTES_PER_DECK`] cap) are
/// skipped — they couldn't be re-linked on import anyway.
fn collect_deck_reviews(
    conn: &Connection,
    deck_id: i64,
    index_by_card_id: &HashMap<i64, usize>,
) -> AppResult<Vec<ExportReview>> {
    let mut stmt = conn.prepare(
        "SELECT r.card_id, r.rating, r.state_before, r.state_after,
                r.stability_before, r.stability_after,
                r.difficulty_before, r.difficulty_after,
                r.elapsed_days, r.scheduled_days, r.review_time, r.reviewed_at,
                r.confidence, r.confidence_post
         FROM reviews r
         JOIN cards c ON c.id = r.card_id
         WHERE c.deck_id = ?1
         ORDER BY r.reviewed_at ASC, r.id ASC",
    )?;
    let rows = stmt.query_map(rusqlite::params![deck_id], |row| {
        let card_id: i64 = row.get(0)?;
        let Some(&card_index) = index_by_card_id.get(&card_id) else {
            return Ok(None);
        };
        let state_before = state_from_sql(2, &row.get::<_, String>(2)?)?;
        let state_after = state_from_sql(3, &row.get::<_, String>(3)?)?;
        Ok(Some(ExportReview {
            card_index,
            rating: row.get(1)?,
            state_before,
            state_after,
            stability_before: row.get(4)?,
            stability_after: row.get(5)?,
            difficulty_before: row.get(6)?,
            difficulty_after: row.get(7)?,
            elapsed_days: row.get(8)?,
            scheduled_days: row.get(9)?,
            review_time: row.get(10)?,
            reviewed_at: row.get(11)?,
            confidence: row.get(12)?,
            confidence_post: row.get(13)?,
        }))
    })?;

    let mut out = Vec::new();
    for r in rows {
        if let Some(review) = r? {
            out.push(review);
        }
    }
    Ok(out)
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
///
/// Version policy: v1 payloads rebuild fresh `new` cards (the historical
/// behaviour); v2 payloads additionally restore each card's scheduling state
/// and the deck's review log. Anything newer than [`EXPORT_VERSION`] is
/// rejected.
pub fn apply_import(db: &Database, import: ExportFile) -> AppResult<ImportResult> {
    if !(1..=EXPORT_VERSION).contains(&import.version) {
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

    // v1 files describe content only — any (hand-added) `cards` / `reviews`
    // sections are ignored so the documented "fresh new cards" contract holds.
    let restore_state = import.version >= 2;

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
    let mut reviews_imported = 0usize;
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

        // P064 — read the card count BEFORE opening the transaction (the deck
        // was just created above, so this is 0 in practice, but reading it
        // outside the BEGIN keeps the before/after framing explicit).
        let card_count_before: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM cards WHERE deck_id = ?1",
                rusqlite::params![deck.id],
                |r| r.get(0),
            )
            .unwrap_or(0);

        // P064 — one transaction per deck instead of one per note. Notes,
        // card-state restoration and review-log rows all land under a single
        // BEGIN/COMMIT (one fsync); on any error we ROLLBACK the whole deck's
        // contents and bubble up.
        conn.execute_batch("BEGIN;")?;
        match import_deck_contents(db, &conn, deck.id, deck_data, restore_state) {
            Ok((deck_notes, deck_reviews)) => {
                conn.execute_batch("COMMIT;")?;
                notes_imported += deck_notes;
                reviews_imported += deck_reviews;
            }
            Err(e) => {
                let _ = conn.execute_batch("ROLLBACK;");
                return Err(e);
            }
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
        reviews_imported,
        skipped_decks,
    })
}

/// Body of the per-deck import transaction: create every note (+ derived
/// cards) via the commit-free `create_inner` (P064) and, for v2 payloads,
/// restore each card's scheduling state and re-insert the deck's review log.
///
/// The caller MUST hold an open transaction and is responsible for the
/// COMMIT/ROLLBACK. Returns `(notes_imported, reviews_imported)`.
fn import_deck_contents(
    db: &Database,
    conn: &Connection,
    deck_id: i64,
    deck_data: ExportDeck,
    restore_state: bool,
) -> AppResult<(usize, usize)> {
    let mut notes_imported = 0usize;
    let mut reviews_imported = 0usize;

    // Re-built flat card sequence, mirroring the export's numbering (notes in
    // file order, each note's cards in file order). `None` marks an exported
    // card that didn't rematerialise (its ordinal isn't derivable from the
    // note's fields — only possible in hand-edited files); keeping the slot
    // preserves the alignment of every later `card_index`.
    let mut flat_card_ids: Vec<Option<i64>> = Vec::new();

    for note in deck_data.notes {
        // NoteRepo::create_inner also materialises every derived card row,
        // so we don't need a separate card-count pass per template.
        let note_id = db.notes(conn).create_inner(
            deck_id,
            note.template,
            note.fields,
            note.tags,
            note.frequency_band,
        )?;
        notes_imported += 1;

        if restore_state {
            for card in &note.cards {
                // Re-link by (note, card_ord): `create_inner` derives the same
                // ordinals from the same fields the export was built from.
                let card_id: Option<i64> = conn
                    .query_row(
                        "SELECT id FROM cards WHERE note_id = ?1 AND card_ord = ?2",
                        rusqlite::params![note_id, card.card_ord],
                        |r| r.get(0),
                    )
                    .optional()?;
                if let Some(id) = card_id {
                    restore_card_state(conn, id, card)?;
                }
                flat_card_ids.push(card_id);
            }
        }
    }

    if restore_state {
        let reviews = db.reviews(conn);
        for review in deck_data.reviews {
            let slot = flat_card_ids.get(review.card_index).ok_or_else(|| {
                AppError::Validation(format!(
                    "review references card_index {} but the deck exports only {} cards",
                    review.card_index,
                    flat_card_ids.len()
                ))
            })?;
            // Reviews of a card that didn't rematerialise are dropped rather
            // than failing the whole deck — the card they describe is gone.
            let Some(card_id) = *slot else {
                continue;
            };
            reviews.insert(
                NewReview {
                    card_id,
                    rating: review.rating,
                    state_before: review.state_before,
                    state_after: review.state_after,
                    stability_before: review.stability_before,
                    stability_after: review.stability_after,
                    difficulty_before: review.difficulty_before,
                    difficulty_after: review.difficulty_after,
                    elapsed_days: review.elapsed_days,
                    scheduled_days: review.scheduled_days,
                    review_time: review.review_time,
                    confidence: review.confidence,
                    confidence_post: review.confidence_post,
                },
                review.reviewed_at,
            )?;
            reviews_imported += 1;
        }
    }

    Ok((notes_imported, reviews_imported))
}

/// Overwrite a freshly-created card's scheduling columns with the exported
/// state, verbatim. Unlike `CardRepo::update_after_review*` (which derives
/// `reps` / `lapses` / `next_review` from a grading step), a restore must not
/// re-derive anything — the export already carries the final values.
fn restore_card_state(conn: &Connection, card_id: i64, card: &ExportCard) -> AppResult<()> {
    let now = chrono::Utc::now().timestamp();
    conn.execute(
        "UPDATE cards
         SET state = ?1,
             stability = ?2,
             difficulty = ?3,
             last_review = ?4,
             next_review = ?5,
             elapsed_days = ?6,
             scheduled_days = ?7,
             reps = ?8,
             lapses = ?9,
             suspended = ?10,
             updated_at = ?11
         WHERE id = ?12",
        rusqlite::params![
            card.state.as_str(),
            card.stability,
            card.difficulty,
            card.last_review,
            card.next_review,
            card.elapsed_days,
            card.scheduled_days,
            card.reps,
            card.lapses,
            card.suspended as i64,
            now,
            card_id,
        ],
    )?;
    Ok(())
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
    use crate::db::{CardState, Database, NewReview, NoteTemplate};
    use serde_json::json;

    /// Fixed timestamp so the scheduling assertions are deterministic.
    const NOW: i64 = 1_700_000_000;
    const DAY: i64 = 86_400;

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

    /// Card id of the card whose parent note's `fields` contains `needle`,
    /// restricted to `card_ord` (basic_reverse / cloze notes own several).
    fn card_id_by_fields(conn: &rusqlite::Connection, needle: &str, card_ord: i64) -> i64 {
        conn.query_row(
            "SELECT c.id FROM cards c
             JOIN notes n ON n.id = c.note_id
             WHERE n.fields LIKE '%' || ?1 || '%' AND c.card_ord = ?2",
            rusqlite::params![needle, card_ord],
            |r| r.get(0),
        )
        .unwrap()
    }

    fn all_deck_ids(db: &Database) -> Vec<i64> {
        let conn = db.lock();
        db.decks(&conn)
            .list()
            .unwrap()
            .iter()
            .map(|d| d.id)
            .collect()
    }

    #[test]
    fn export_envelope_contains_all_notes() {
        let db = seed_db_with_two_decks();
        let deck_ids = all_deck_ids(&db);

        let export = build_export(&db, &deck_ids).unwrap();
        assert_eq!(export.version, 2);
        assert_eq!(export.app, "Mnemosys");
        assert_eq!(export.decks.len(), 2);

        let total_notes: usize = export.decks.iter().map(|d| d.notes.len()).sum();
        assert_eq!(total_notes, 3);

        // v2 — every derived card rides along with its note:
        // 1 basic + 2 basic_reverse + 2 cloze = 5.
        let total_cards: usize = export
            .decks
            .iter()
            .flat_map(|d| d.notes.iter())
            .map(|n| n.cards.len())
            .sum();
        assert_eq!(total_cards, 5);

        // Never-reviewed decks export an empty review log.
        assert!(export.decks.iter().all(|d| d.reviews.is_empty()));
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
        let deck_ids = all_deck_ids(&src_db);
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
        assert_eq!(report.reviews_imported, 0, "nothing was ever reviewed");
        assert!(report.skipped_decks.is_empty());

        let conn = dst_db.lock();
        let decks = dst_db.decks(&conn).list().unwrap();
        let names: Vec<&str> = decks.iter().map(|d| d.name.as_str()).collect();
        assert!(names.contains(&"Spanish"));
        assert!(names.contains(&"Capitals"));
    }

    /// v2 — the whole point of the format bump: FSRS scheduling state and the
    /// review log survive an export → wipe → import cycle.
    #[test]
    fn v2_round_trip_restores_card_state_and_review_log() {
        let src_db = seed_db_with_two_decks();

        // Review the "hola" card and suspend one "adios" card so the source
        // DB carries genuine scheduling state, then export.
        {
            let conn = src_db.lock();
            let hola = card_id_by_fields(&conn, "hola", 0);
            let before = src_db.cards(&conn).get(hola).unwrap();
            let after = src_db
                .cards(&conn)
                .update_after_review(hola, CardState::Review, 12.5, 4.2, 4, NOW)
                .unwrap();
            src_db
                .reviews(&conn)
                .insert(
                    NewReview {
                        card_id: hola,
                        rating: 3,
                        state_before: before.state,
                        state_after: after.state,
                        stability_before: before.stability,
                        stability_after: 12.5,
                        difficulty_before: before.difficulty,
                        difficulty_after: 4.2,
                        elapsed_days: 0,
                        scheduled_days: 4,
                        review_time: 3_200,
                        confidence: Some(4),
                        confidence_post: Some(2),
                    },
                    NOW,
                )
                .unwrap();

            let adios_reverse = card_id_by_fields(&conn, "adios", 1);
            src_db.cards(&conn).suspend(adios_reverse, true).unwrap();
        }

        let deck_ids = all_deck_ids(&src_db);
        let export = build_export(&src_db, &deck_ids).unwrap();
        assert_eq!(export.version, 2);
        let spanish = export
            .decks
            .iter()
            .find(|d| d.name == "Spanish")
            .expect("Spanish deck exported");
        assert_eq!(spanish.reviews.len(), 1, "one review row exported");

        // Disk round-trip, then import into a pristine database.
        let json = serde_json::to_string(&export).unwrap();
        let parsed: ExportFile = serde_json::from_str(&json).unwrap();
        let dst_db = Database::for_test();
        let report = apply_import(&dst_db, parsed).unwrap();

        assert_eq!(report.decks_imported, 2);
        assert_eq!(report.notes_imported, 3);
        assert_eq!(report.cards_created, 5);
        assert_eq!(report.reviews_imported, 1);

        let conn = dst_db.lock();

        // The reviewed card keeps its full FSRS state.
        let hola = card_id_by_fields(&conn, "hola", 0);
        let card = dst_db.cards(&conn).get(hola).unwrap();
        assert_eq!(card.state, CardState::Review);
        assert_eq!(card.stability, Some(12.5));
        assert_eq!(card.difficulty, Some(4.2));
        assert_eq!(card.last_review, Some(NOW));
        assert_eq!(card.next_review, Some(NOW + 4 * DAY));
        assert_eq!(card.elapsed_days, 0);
        assert_eq!(card.scheduled_days, 4);
        assert_eq!(card.reps, 1);
        assert_eq!(card.lapses, 0);

        // The suspended flag round-trips too.
        let adios_reverse = card_id_by_fields(&conn, "adios", 1);
        let suspended = dst_db.cards(&conn).get(adios_reverse).unwrap();
        assert!(suspended.suspended, "suspension survives the round-trip");

        // The review log is restored against the freshly-minted card id.
        let log = dst_db.reviews(&conn).list_for_card(hola).unwrap();
        assert_eq!(log.len(), 1);
        assert_eq!(log[0].rating, 3);
        assert_eq!(log[0].reviewed_at, NOW);
        assert_eq!(log[0].state_before, CardState::New);
        assert_eq!(log[0].state_after, CardState::Review);
        assert_eq!(log[0].stability_after, 12.5);
        assert_eq!(log[0].elapsed_days, 0);
        assert_eq!(log[0].scheduled_days, 4);
        assert_eq!(log[0].review_time, 3_200);
        assert_eq!(log[0].confidence, Some(4));
        assert_eq!(log[0].confidence_post, Some(2));

        // Untouched cards come back pristine `new`.
        let cloze = card_id_by_fields(&conn, "France", 1);
        let fresh = dst_db.cards(&conn).get(cloze).unwrap();
        assert_eq!(fresh.state, CardState::New);
        assert!(fresh.stability.is_none());
        assert!(fresh.next_review.is_none());
    }

    /// Backwards compatibility — a v1 file (no `cards` / `reviews` keys)
    /// imports exactly as before: content only, fresh `new` cards.
    #[test]
    fn v1_payload_imports_as_fresh_cards() {
        let raw = r##"{
            "version": 1,
            "exported_at": 0,
            "app": "Mnemosys",
            "decks": [{
                "name": "Legacy",
                "description": null,
                "color": "#3b82f6",
                "desired_retention": 0.9,
                "notes": [
                    { "template": "basic", "fields": { "front": "f", "back": "b" }, "tags": [] }
                ]
            }]
        }"##;
        let parsed: ExportFile = serde_json::from_str(raw).unwrap();

        let db = Database::for_test();
        let report = apply_import(&db, parsed).unwrap();
        assert_eq!(report.decks_imported, 1);
        assert_eq!(report.notes_imported, 1);
        assert_eq!(report.cards_created, 1);
        assert_eq!(report.reviews_imported, 0);

        let conn = db.lock();
        let card_id: i64 = conn
            .query_row("SELECT id FROM cards", [], |r| r.get(0))
            .unwrap();
        let card = db.cards(&conn).get(card_id).unwrap();
        assert_eq!(card.state, CardState::New);
        assert!(card.stability.is_none());
        assert!(card.next_review.is_none());
        assert_eq!(card.reps, 0);
    }

    /// A payload with no `version` key at all is treated as v1.
    #[test]
    fn versionless_payload_defaults_to_v1() {
        let raw = r#"{ "exported_at": 0, "app": "Mnemosys", "decks": [] }"#;
        let parsed: ExportFile = serde_json::from_str(raw).unwrap();
        assert_eq!(parsed.version, 1);

        let db = Database::for_test();
        let report = apply_import(&db, parsed).unwrap();
        assert_eq!(report.decks_imported, 0);
    }

    /// A `version: 1` payload that (illegally) smuggles `cards` / `reviews`
    /// sections gets the documented v1 treatment: the sections are ignored
    /// and the cards are rebuilt fresh.
    #[test]
    fn v1_payload_ignores_scheduling_sections() {
        let raw = r##"{
            "version": 1,
            "exported_at": 0,
            "app": "Mnemosys",
            "decks": [{
                "name": "Sneaky",
                "description": null,
                "color": "#3b82f6",
                "desired_retention": 0.9,
                "notes": [{
                    "template": "basic",
                    "fields": { "front": "f", "back": "b" },
                    "tags": [],
                    "cards": [{
                        "card_ord": 0, "state": "review", "stability": 99.0,
                        "difficulty": 3.0, "last_review": 1000, "next_review": 2000,
                        "elapsed_days": 1, "scheduled_days": 1, "reps": 9,
                        "lapses": 2, "suspended": true
                    }]
                }],
                "reviews": [{
                    "card_index": 0, "rating": 3, "state_before": "new",
                    "state_after": "review", "stability_before": null,
                    "stability_after": 5.0, "difficulty_before": null,
                    "difficulty_after": 5.0, "elapsed_days": 0,
                    "scheduled_days": 5, "review_time": 1000, "reviewed_at": 1000
                }]
            }]
        }"##;
        let parsed: ExportFile = serde_json::from_str(raw).unwrap();

        let db = Database::for_test();
        let report = apply_import(&db, parsed).unwrap();
        assert_eq!(report.reviews_imported, 0, "v1 review sections are ignored");

        let conn = db.lock();
        let card_id: i64 = conn
            .query_row("SELECT id FROM cards", [], |r| r.get(0))
            .unwrap();
        let card = db.cards(&conn).get(card_id).unwrap();
        assert_eq!(card.state, CardState::New, "v1 cards are rebuilt fresh");
        assert!(!card.suspended);
        let review_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM reviews", [], |r| r.get(0))
            .unwrap();
        assert_eq!(review_count, 0);
    }

    /// A v2 review pointing past the deck's card sequence is a malformed file.
    #[test]
    fn v2_rejects_out_of_range_card_index() {
        let raw = r##"{
            "version": 2,
            "exported_at": 0,
            "app": "Mnemosys",
            "decks": [{
                "name": "Broken",
                "description": null,
                "color": "#3b82f6",
                "desired_retention": 0.9,
                "notes": [{
                    "template": "basic",
                    "fields": { "front": "f", "back": "b" },
                    "tags": [],
                    "cards": [{
                        "card_ord": 0, "state": "new", "stability": null,
                        "difficulty": null, "last_review": null, "next_review": null,
                        "elapsed_days": 0, "scheduled_days": 0, "reps": 0,
                        "lapses": 0, "suspended": false
                    }]
                }],
                "reviews": [{
                    "card_index": 7, "rating": 3, "state_before": "new",
                    "state_after": "review", "stability_before": null,
                    "stability_after": 5.0, "difficulty_before": null,
                    "difficulty_after": 5.0, "elapsed_days": 0,
                    "scheduled_days": 5, "review_time": 1000, "reviewed_at": 1000
                }]
            }]
        }"##;
        let parsed: ExportFile = serde_json::from_str(raw).unwrap();

        let db = Database::for_test();
        let err = apply_import(&db, parsed).unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));

        // The failed deck's transaction rolled back: no orphan notes/cards.
        let conn = db.lock();
        let note_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM notes", [], |r| r.get(0))
            .unwrap();
        assert_eq!(note_count, 0, "the whole deck's contents rolled back");
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
        let deck_ids = all_deck_ids(&src_db);
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
