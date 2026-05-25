//! Integration tests for the DB layer.
//!
//! All tests run against an in-memory SQLite database (`Database::for_test()`)
//! so they're hermetic and fast. They exercise the contracts that downstream
//! agents rely on (decks → notes → cards cascade, FTS5 search, FSRS scheduler
//! update flow, etc.).

use mnemosys_lib::db::{
    cards::CardState, decks::DeckPatch, notes::NoteTemplate, reviews::NewReview, Database,
};
use serde_json::json;

// ---- helpers ---------------------------------------------------------------

/// Returns a deck id seeded into a fresh in-memory DB.
fn fresh_db_with_deck() -> (Database, i64) {
    let db = Database::for_test();
    let conn = db.lock();
    let deck = db
        .decks(&conn)
        .create("Default", None, "#3b82f6", 0.9)
        .expect("create deck");
    (db.clone(), deck.id)
}

// ---- deck tests ------------------------------------------------------------

#[test]
fn create_deck_returns_deck_with_id() {
    let db = Database::for_test();
    let conn = db.lock();
    let deck = db
        .decks(&conn)
        .create("Spanish", Some("Vocab"), "#ff0000", 0.92)
        .expect("create deck");
    assert!(deck.id > 0);
    assert_eq!(deck.name, "Spanish");
    assert_eq!(deck.description.as_deref(), Some("Vocab"));
    assert_eq!(deck.color, "#ff0000");
    assert!((deck.desired_retention - 0.92).abs() < 1e-9);
}

#[test]
fn list_decks_alphabetical() {
    let db = Database::for_test();
    let conn = db.lock();
    let repo = db.decks(&conn);
    repo.create("Charlie", None, "#000000", 0.9).unwrap();
    repo.create("alpha", None, "#000000", 0.9).unwrap();
    repo.create("Bravo", None, "#000000", 0.9).unwrap();

    let decks = repo.list().unwrap();
    let names: Vec<&str> = decks.iter().map(|d| d.name.as_str()).collect();
    assert_eq!(names, vec!["alpha", "Bravo", "Charlie"]);
}

#[test]
fn update_deck_partial() {
    let (db, deck_id) = fresh_db_with_deck();
    let conn = db.lock();
    let updated = db
        .decks(&conn)
        .update(
            deck_id,
            DeckPatch {
                name: Some("Renamed".into()),
                description: Some(Some("new description".into())),
                color: None,
                desired_retention: Some(0.85),
            },
        )
        .expect("update");
    assert_eq!(updated.name, "Renamed");
    assert_eq!(updated.description.as_deref(), Some("new description"));
    assert_eq!(updated.color, "#3b82f6"); // unchanged
    assert!((updated.desired_retention - 0.85).abs() < 1e-9);
}

#[test]
fn delete_deck_cascades_notes_and_cards() {
    let (db, deck_id) = fresh_db_with_deck();
    let conn = db.lock();

    // Add a basic note (creates 1 card)
    let note = db
        .notes(&conn)
        .create(
            deck_id,
            NoteTemplate::Basic,
            json!({ "front": "hola", "back": "hello" }),
            vec!["greetings".into()],
        )
        .expect("create note");

    let note_count_before: i64 = conn
        .query_row("SELECT COUNT(*) FROM notes", [], |r| r.get(0))
        .unwrap();
    let card_count_before: i64 = conn
        .query_row("SELECT COUNT(*) FROM cards", [], |r| r.get(0))
        .unwrap();
    assert_eq!(note_count_before, 1);
    assert_eq!(card_count_before, 1);
    assert!(note.id > 0);

    db.decks(&conn).delete(deck_id).unwrap();

    let note_count_after: i64 = conn
        .query_row("SELECT COUNT(*) FROM notes", [], |r| r.get(0))
        .unwrap();
    let card_count_after: i64 = conn
        .query_row("SELECT COUNT(*) FROM cards", [], |r| r.get(0))
        .unwrap();
    assert_eq!(note_count_after, 0, "notes should cascade-delete");
    assert_eq!(card_count_after, 0, "cards should cascade-delete");
}

// ---- note + card creation --------------------------------------------------

#[test]
fn create_note_basic_creates_1_card() {
    let (db, deck_id) = fresh_db_with_deck();
    let conn = db.lock();
    let note = db
        .notes(&conn)
        .create(
            deck_id,
            NoteTemplate::Basic,
            json!({ "front": "Q", "back": "A" }),
            vec![],
        )
        .unwrap();

    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM cards WHERE note_id = ?1",
            rusqlite::params![note.id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 1);
}

#[test]
fn create_note_basic_reverse_creates_2_cards() {
    let (db, deck_id) = fresh_db_with_deck();
    let conn = db.lock();
    let note = db
        .notes(&conn)
        .create(
            deck_id,
            NoteTemplate::BasicReverse,
            json!({ "front": "hola", "back": "hello" }),
            vec![],
        )
        .unwrap();

    let mut stmt = conn
        .prepare("SELECT card_ord FROM cards WHERE note_id = ?1 ORDER BY card_ord ASC")
        .unwrap();
    let ords: Vec<i64> = stmt
        .query_map(rusqlite::params![note.id], |r| r.get::<_, i64>(0))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    assert_eq!(ords, vec![0, 1]);
}

#[test]
fn create_note_cloze_creates_n_cards() {
    let (db, deck_id) = fresh_db_with_deck();
    let conn = db.lock();
    let note = db
        .notes(&conn)
        .create(
            deck_id,
            NoteTemplate::Cloze,
            json!({
                "text": "The {{c1::capital}} of {{c2::France}} is {{c3::Paris}}"
            }),
            vec![],
        )
        .unwrap();

    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM cards WHERE note_id = ?1",
            rusqlite::params![note.id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 3, "expected one card per unique cloze index");
}

// ---- FTS5 search -----------------------------------------------------------

#[test]
fn fts_search_returns_matching_notes() {
    let (db, deck_id) = fresh_db_with_deck();
    let conn = db.lock();
    db.notes(&conn)
        .create(
            deck_id,
            NoteTemplate::Basic,
            json!({ "front": "hola mundo", "back": "hello world" }),
            vec!["spanish".into()],
        )
        .unwrap();
    db.notes(&conn)
        .create(
            deck_id,
            NoteTemplate::Basic,
            json!({ "front": "adios", "back": "goodbye" }),
            vec!["spanish".into()],
        )
        .unwrap();

    let hits = db.notes(&conn).search("hola", 10).unwrap();
    assert_eq!(hits.len(), 1);
    assert!(hits[0].fields.to_string().contains("hola"));

    let hits_all = db.notes(&conn).search("spanish", 10).unwrap();
    assert_eq!(hits_all.len(), 2);
}

// ---- due-card scheduling ---------------------------------------------------

#[test]
fn due_cards_excludes_suspended() {
    let (db, deck_id) = fresh_db_with_deck();
    let conn = db.lock();
    let note = db
        .notes(&conn)
        .create(
            deck_id,
            NoteTemplate::Basic,
            json!({ "front": "Q", "back": "A" }),
            vec![],
        )
        .unwrap();
    // The note's lone card lives at id=1 (fresh DB).
    let card = db
        .cards(&conn)
        .list_in_deck(deck_id, 10, 0)
        .unwrap()
        .pop()
        .unwrap()
        .card;
    assert_eq!(card.note_id, note.id);

    // Move into "review" with a due time in the past.
    let now = 1_700_000_000_i64;
    db.cards(&conn)
        .update_after_review(card.id, CardState::Review, 5.0, 5.0, -1, now)
        .unwrap();

    // Should appear as due.
    let due = db.cards(&conn).due_cards(Some(deck_id), now, 10).unwrap();
    assert_eq!(due.len(), 1);

    // Suspend → disappears.
    db.cards(&conn).suspend(card.id, true).unwrap();
    let due_after = db.cards(&conn).due_cards(Some(deck_id), now, 10).unwrap();
    assert_eq!(due_after.len(), 0);
}

// ---- reviews ---------------------------------------------------------------

#[test]
fn insert_review_returns_review_with_id() {
    let (db, deck_id) = fresh_db_with_deck();
    let conn = db.lock();
    db.notes(&conn)
        .create(
            deck_id,
            NoteTemplate::Basic,
            json!({ "front": "Q", "back": "A" }),
            vec![],
        )
        .unwrap();
    let card_id = db
        .cards(&conn)
        .list_in_deck(deck_id, 10, 0)
        .unwrap()
        .pop()
        .unwrap()
        .card
        .id;

    let now = 1_700_000_000_i64;
    let review = db
        .reviews(&conn)
        .insert(
            NewReview {
                card_id,
                rating: 3,
                state_before: CardState::New,
                state_after: CardState::Learning,
                stability_before: None,
                stability_after: 1.5,
                difficulty_before: None,
                difficulty_after: 5.0,
                elapsed_days: 0,
                scheduled_days: 1,
                review_time: 4_500,
            },
            now,
        )
        .unwrap();

    assert!(review.id > 0);
    assert_eq!(review.card_id, card_id);
    assert_eq!(review.rating, 3);
    assert!((review.stability_after - 1.5).abs() < 1e-9);
}

// ---- extras ---------------------------------------------------------------

#[test]
fn deck_stats_counts_by_state() {
    let (db, deck_id) = fresh_db_with_deck();
    let conn = db.lock();
    // 2 brand-new cards
    db.notes(&conn)
        .create(
            deck_id,
            NoteTemplate::BasicReverse,
            json!({ "front": "Q", "back": "A" }),
            vec![],
        )
        .unwrap();
    let stats = db.decks(&conn).stats(deck_id).unwrap();
    assert_eq!(stats.total_cards, 2);
    assert_eq!(stats.new_cards, 2);
    assert_eq!(stats.review_cards, 0);
    assert_eq!(stats.learning_cards, 0);
    assert_eq!(stats.due_today, 0);
}

#[test]
fn fsrs_params_seeded_on_init() {
    let db = Database::for_test();
    let conn = db.lock();
    let v = db.params(&conn).get().unwrap();
    assert_eq!(v.len(), 21, "FSRS-5 expects 21 parameters");

    // Round-trip a new vector.
    let new_vec: Vec<f32> = (0..21).map(|i| (i as f32) * 0.1).collect();
    db.params(&conn)
        .set(new_vec.clone(), Some(1_700_000_000), 42)
        .unwrap();
    let after = db.params(&conn).get().unwrap();
    assert_eq!(after, new_vec);
}
