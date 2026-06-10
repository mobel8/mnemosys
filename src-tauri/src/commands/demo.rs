//! Demo data loader.
//!
//! Bundles four curated demo decks (835 notes total: EN→FR vocab, world
//! capitals, JS/TS fundamentals, biologie cellulaire) and ingests them through
//! the regular `DeckRepo` / `NoteRepo` so the resulting cards behave exactly
//! like user-created content.
//!
//! Idempotent: calling `load_demo_decks` twice does **not** duplicate decks.
//! A deck is skipped when a deck with the same `name` already exists. The
//! return value is the number of decks that were actually inserted by this
//! call, so the UI can flash an accurate toast ("Loaded N demo decks").
//!
//! The JSON payload is embedded into the binary via `include_str!`, so no
//! filesystem lookup is needed at runtime — the demo data is available even
//! before the user has any data directory of their own.

use serde::Deserialize;
use tauri::State;

use crate::app_state::AppState;
use crate::db::{Database, NoteTemplate};
use crate::error::AppResult;

/// Compile-time embedding. `src-tauri/data/demo_decks.json` is generated and
/// hand-curated; see the file header for sourcing notes.
const DEMO_DATA: &str = include_str!("../../data/demo_decks.json");

/// Top-level wrapper in the JSON payload. `version` lets us evolve the schema
/// later without silently mis-parsing an older file.
#[derive(Deserialize)]
struct DemoFile {
    #[allow(dead_code)]
    version: u32,
    decks: Vec<DemoDeck>,
}

#[derive(Deserialize)]
struct DemoDeck {
    name: String,
    description: Option<String>,
    color: String,
    desired_retention: f64,
    notes: Vec<DemoNote>,
}

#[derive(Deserialize)]
struct DemoNote {
    template: NoteTemplate,
    fields: serde_json::Value,
    tags: Vec<String>,
}

/// Tauri-facing handler. Pulls the shared `Database` off `AppState` and
/// delegates to [`load_demo_decks_inner`] so the loading logic can be exercised
/// from tests without spinning up a Tauri runtime.
#[tauri::command]
pub fn load_demo_decks(state: State<'_, AppState>) -> AppResult<usize> {
    load_demo_decks_inner(&state.db)
}

/// Insert any demo deck that isn't already present (matched by `name`).
///
/// Returns the number of newly-created decks. Note rows are inserted via the
/// commit-free `NoteRepo::create_inner` under ONE transaction per deck (P064):
/// each note still materialises its per-template card rows, but the deck pays
/// a single COMMIT/fsync instead of one per note — first-launch loading of the
/// 835 demo notes is near instant instead of 835 individual transactions.
pub fn load_demo_decks_inner(db: &Database) -> AppResult<usize> {
    let data: DemoFile = serde_json::from_str(DEMO_DATA)?;
    let conn = db.lock();

    // Snapshot of existing deck names so we can short-circuit duplicates
    // without re-querying inside the loop. The list is tiny (a handful of
    // decks at most) so the allocation is negligible.
    let existing: std::collections::HashSet<String> = db
        .decks(&conn)
        .list()?
        .into_iter()
        .map(|d| d.name)
        .collect();

    let mut decks_loaded = 0usize;
    for deck_data in data.decks {
        if existing.contains(&deck_data.name) {
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

        // P064 — one transaction per deck instead of one per note.
        // `create_inner` is the BEGIN/COMMIT-free variant of `NoteRepo::create`
        // and still materialises the matching card rows. Fail-fast on the
        // first error with a ROLLBACK of the whole deck's notes — partially-
        // loaded decks would be visible to the user and confusing.
        conn.execute_batch("BEGIN;")?;
        for note in deck_data.notes {
            // Demo decks predate Vague 10 — no frequency tagging needed.
            if let Err(e) =
                db.notes(&conn)
                    .create_inner(deck.id, note.template, note.fields, note.tags, None)
            {
                let _ = conn.execute_batch("ROLLBACK;");
                return Err(e);
            }
        }
        conn.execute_batch("COMMIT;")?;

        decks_loaded += 1;
    }

    Ok(decks_loaded)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_json_parses_cleanly() {
        // Catches a corrupted demo_decks.json at unit-test time rather than
        // letting the failure surface at first launch.
        let parsed: DemoFile =
            serde_json::from_str(DEMO_DATA).expect("demo_decks.json must be valid JSON");
        assert_eq!(parsed.version, 1, "schema version pinned at 1");
        assert_eq!(parsed.decks.len(), 4, "four demo decks shipped");

        let total_notes: usize = parsed.decks.iter().map(|d| d.notes.len()).sum();
        assert_eq!(total_notes, 835, "835 notes total (500 + 195 + 80 + 60)");
    }

    #[test]
    fn load_demo_decks_inserts_four_decks() {
        let db = Database::for_test();
        let loaded = load_demo_decks_inner(&db).expect("load demo");
        assert_eq!(loaded, 4, "all four decks loaded on a fresh DB");

        let conn = db.lock();
        assert_eq!(db.decks(&conn).count().unwrap(), 4);
    }

    #[test]
    fn load_demo_decks_is_idempotent() {
        let db = Database::for_test();
        let first = load_demo_decks_inner(&db).expect("first load");
        let second = load_demo_decks_inner(&db).expect("second load");
        assert_eq!(first, 4, "first call loads all four");
        assert_eq!(second, 0, "second call is a no-op");

        let conn = db.lock();
        assert_eq!(
            db.decks(&conn).count().unwrap(),
            4,
            "no duplicate decks were inserted"
        );
    }

    #[test]
    fn loaded_notes_materialise_cards() {
        let db = Database::for_test();
        load_demo_decks_inner(&db).expect("load demo");

        let conn = db.lock();
        let decks = db.decks(&conn).list().unwrap();
        // The "Capitales du monde" deck uses `basic_reverse` (2 cards per
        // note), so the card count should be exactly 2× the note count.
        let capitals = decks
            .iter()
            .find(|d| d.name == "Capitales du monde")
            .expect("capitals deck present");
        let note_count = db.notes(&conn).count_in_deck(capitals.id).unwrap();
        let stats = db.decks(&conn).stats(capitals.id).unwrap();
        assert_eq!(note_count, 195);
        assert_eq!(stats.total_cards, note_count * 2);
    }
}
