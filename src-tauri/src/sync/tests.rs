//! Pure unit tests for the sync subsystem.
//!
//! Everything here runs on an in-memory SQLite (`Database::for_test()`)
//! — no reqwest, no network. The goal is to lock down the two pieces that
//! _can_ be tested without a Supabase project: delta extraction and the
//! LWW merge in `apply`.

use rusqlite::params;
use serde_json::json;

use crate::db::Database;

use super::apply::{
    apply_cards, apply_decks, apply_notes, apply_reviews, lww_should_replace, write_cursor,
};
use super::client::{RemoteCard, RemoteDeck, RemoteNote, RemoteReview};
use super::delta::{extract_decks, extract_notes, extract_reviews};

// ---------------------------------------------------------------------------
// LWW helper
// ---------------------------------------------------------------------------

#[test]
fn lww_replaces_when_remote_strictly_newer() {
    assert!(lww_should_replace(20, 10));
    assert!(!lww_should_replace(10, 20));
    // Equal timestamps → keep local (deterministic tie-break).
    assert!(!lww_should_replace(10, 10));
}

// ---------------------------------------------------------------------------
// Delta extraction
// ---------------------------------------------------------------------------

#[test]
fn extract_decks_includes_unsynced_and_recently_updated() {
    let db = Database::for_test();
    let conn = db.lock();

    // One legacy deck (already synced — has a remote_id), one brand-new.
    conn.execute(
        "INSERT INTO decks (name, color, desired_retention, created_at, updated_at, remote_id)
         VALUES ('Synced', '#fff', 0.9, 100, 100, 'uuid-1')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO decks (name, color, desired_retention, created_at, updated_at)
         VALUES ('Fresh', '#000', 0.9, 200, 200)",
        [],
    )
    .unwrap();

    // Cursor at 150 → 'Synced' was touched before, 'Fresh' after.
    // But 'Synced' also has `remote_id` set, so unless updated_at > since
    // it shouldn't appear. 'Fresh' lacks remote_id so it should appear.
    let rows = extract_decks(&conn, 150).expect("extract");
    let names: Vec<String> = rows.iter().map(|r| r.name.clone()).collect();
    assert!(names.contains(&"Fresh".to_string()));
    assert!(!names.contains(&"Synced".to_string()));
}

#[test]
fn extract_notes_carries_parent_deck_remote_id() {
    let db = Database::for_test();
    let conn = db.lock();

    let deck = db
        .decks(&conn)
        .create("Anatomy", None, "#fff", 0.9)
        .expect("deck");
    conn.execute(
        "UPDATE decks SET remote_id = 'deck-uuid' WHERE id = ?1",
        params![deck.id],
    )
    .unwrap();
    let _note = db
        .notes(&conn)
        .create(
            deck.id,
            crate::db::notes::NoteTemplate::Basic,
            json!({ "front": "Q", "back": "A" }),
            vec![],
        )
        .expect("note");

    let rows = extract_notes(&conn, 0).expect("extract notes");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].deck_id, "deck-uuid");
}

#[test]
fn extract_reviews_skips_unsynced_parent_cards() {
    let db = Database::for_test();
    let conn = db.lock();

    let deck = db.decks(&conn).create("D", None, "#fff", 0.9).unwrap();
    let note = db
        .notes(&conn)
        .create(
            deck.id,
            crate::db::notes::NoteTemplate::Basic,
            json!({ "front": "Q", "back": "A" }),
            vec![],
        )
        .unwrap();
    // Force the card to lack a remote_id (default state for a fresh row).
    let card_id: i64 = conn
        .query_row(
            "SELECT id FROM cards WHERE note_id = ?1",
            params![note.id],
            |r| r.get(0),
        )
        .unwrap();
    conn.execute(
        "INSERT INTO reviews (card_id, rating, state_before, state_after,
            stability_after, difficulty_after, elapsed_days, scheduled_days,
            review_time, reviewed_at)
         VALUES (?1, 3, 'new', 'review', 1.0, 5.0, 0, 1, 1000, 500)",
        params![card_id],
    )
    .unwrap();

    let rows = extract_reviews(&conn, 0).expect("extract reviews");
    assert!(
        rows.is_empty(),
        "reviews with no card.remote_id must not be pushed"
    );
}

// ---------------------------------------------------------------------------
// Apply / LWW merge
// ---------------------------------------------------------------------------

#[test]
fn apply_decks_inserts_unknown_remote_row() {
    let db = Database::for_test();
    let conn = db.lock();

    let remote = vec![RemoteDeck {
        id: "deck-uuid-1".into(),
        name: "Cloud Deck".into(),
        description: None,
        color: "#a0a".into(),
        desired_retention: 0.92,
        created_at: 100,
        updated_at: 100,
        deleted_at: None,
    }];

    let stats = apply_decks(&conn, &remote).expect("apply");
    assert_eq!(stats.inserted, 1);

    let name: String = conn
        .query_row("SELECT name FROM decks WHERE remote_id = ?1", params!["deck-uuid-1"], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(name, "Cloud Deck");
}

#[test]
fn apply_decks_lww_keeps_local_when_remote_older() {
    let db = Database::for_test();
    let conn = db.lock();
    conn.execute(
        "INSERT INTO decks (name, color, desired_retention, created_at, updated_at, remote_id)
         VALUES ('Local newer', '#fff', 0.9, 100, 500, 'uuid-x')",
        [],
    )
    .unwrap();

    let remote = vec![RemoteDeck {
        id: "uuid-x".into(),
        name: "Older remote".into(),
        description: None,
        color: "#000".into(),
        desired_retention: 0.9,
        created_at: 100,
        updated_at: 300,
        deleted_at: None,
    }];

    let stats = apply_decks(&conn, &remote).expect("apply");
    assert_eq!(stats.skipped, 1);
    assert_eq!(stats.updated, 0);

    let name: String = conn
        .query_row("SELECT name FROM decks WHERE remote_id = 'uuid-x'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(name, "Local newer");
}

#[test]
fn apply_decks_lww_replaces_when_remote_newer() {
    let db = Database::for_test();
    let conn = db.lock();
    conn.execute(
        "INSERT INTO decks (name, color, desired_retention, created_at, updated_at, remote_id)
         VALUES ('Stale local', '#fff', 0.9, 100, 200, 'uuid-y')",
        [],
    )
    .unwrap();

    let remote = vec![RemoteDeck {
        id: "uuid-y".into(),
        name: "Fresh remote".into(),
        description: Some("hello".into()),
        color: "#abc".into(),
        desired_retention: 0.95,
        created_at: 100,
        updated_at: 999,
        deleted_at: None,
    }];

    let stats = apply_decks(&conn, &remote).expect("apply");
    assert_eq!(stats.updated, 1);

    let (name, retention): (String, f64) = conn
        .query_row(
            "SELECT name, desired_retention FROM decks WHERE remote_id = 'uuid-y'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(name, "Fresh remote");
    assert!((retention - 0.95).abs() < 1e-9);
}

#[test]
fn apply_decks_tombstone_deletes_when_strictly_newer() {
    let db = Database::for_test();
    let conn = db.lock();
    conn.execute(
        "INSERT INTO decks (name, color, desired_retention, created_at, updated_at, remote_id)
         VALUES ('Doomed', '#fff', 0.9, 100, 200, 'uuid-z')",
        [],
    )
    .unwrap();

    let remote = vec![RemoteDeck {
        id: "uuid-z".into(),
        name: "Doomed".into(),
        description: None,
        color: "#fff".into(),
        desired_retention: 0.9,
        created_at: 100,
        updated_at: 200,
        deleted_at: Some(999),
    }];

    let stats = apply_decks(&conn, &remote).expect("apply");
    assert_eq!(stats.deleted, 1);

    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM decks WHERE remote_id = 'uuid-z'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 0);
}

#[test]
fn apply_notes_skips_when_parent_deck_unknown() {
    let db = Database::for_test();
    let conn = db.lock();

    let remote = vec![RemoteNote {
        id: "note-uuid".into(),
        deck_id: "missing-deck-uuid".into(),
        template: "basic".into(),
        fields: json!({ "front": "Q", "back": "A" }),
        tags: vec![],
        created_at: 100,
        updated_at: 100,
        deleted_at: None,
    }];

    let stats = apply_notes(&conn, &remote).expect("apply");
    assert_eq!(stats.skipped, 1);
    assert_eq!(stats.inserted, 0);
}

#[test]
fn apply_reviews_unions_by_card_and_reviewed_at() {
    let db = Database::for_test();
    let conn = db.lock();

    let deck = db.decks(&conn).create("D", None, "#fff", 0.9).unwrap();
    conn.execute(
        "UPDATE decks SET remote_id = 'd-uuid' WHERE id = ?1",
        params![deck.id],
    )
    .unwrap();
    let note = db
        .notes(&conn)
        .create(
            deck.id,
            crate::db::notes::NoteTemplate::Basic,
            json!({ "front": "Q", "back": "A" }),
            vec![],
        )
        .unwrap();
    conn.execute(
        "UPDATE notes SET remote_id = 'n-uuid' WHERE id = ?1",
        params![note.id],
    )
    .unwrap();
    let card_id: i64 = conn
        .query_row(
            "SELECT id FROM cards WHERE note_id = ?1",
            params![note.id],
            |r| r.get(0),
        )
        .unwrap();
    conn.execute(
        "UPDATE cards SET remote_id = 'c-uuid' WHERE id = ?1",
        params![card_id],
    )
    .unwrap();

    let remote = vec![
        RemoteReview {
            id: "r-1".into(),
            card_id: "c-uuid".into(),
            rating: 3,
            state_before: "new".into(),
            state_after: "review".into(),
            stability_before: None,
            stability_after: 1.0,
            difficulty_before: None,
            difficulty_after: 5.0,
            elapsed_days: 0,
            scheduled_days: 1,
            review_time: 1000,
            reviewed_at: 500,
        },
        // Duplicate reviewed_at — must be skipped.
        RemoteReview {
            id: "r-1-dup".into(),
            card_id: "c-uuid".into(),
            rating: 3,
            state_before: "new".into(),
            state_after: "review".into(),
            stability_before: None,
            stability_after: 1.0,
            difficulty_before: None,
            difficulty_after: 5.0,
            elapsed_days: 0,
            scheduled_days: 1,
            review_time: 1000,
            reviewed_at: 500,
        },
    ];

    let stats = apply_reviews(&conn, &remote).expect("apply reviews");
    assert_eq!(stats.inserted, 1);
    assert_eq!(stats.skipped, 1);

    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM reviews WHERE card_id = ?1",
            params![card_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 1);
}

#[test]
fn apply_cards_inserts_when_parents_exist() {
    let db = Database::for_test();
    let conn = db.lock();
    // Seed parent deck + note.
    let deck = db.decks(&conn).create("D", None, "#fff", 0.9).unwrap();
    conn.execute(
        "UPDATE decks SET remote_id = 'd2' WHERE id = ?1",
        params![deck.id],
    )
    .unwrap();
    let note = db
        .notes(&conn)
        .create(
            deck.id,
            crate::db::notes::NoteTemplate::Basic,
            json!({ "front": "Q", "back": "A" }),
            vec![],
        )
        .unwrap();
    conn.execute(
        "UPDATE notes SET remote_id = 'n2' WHERE id = ?1",
        params![note.id],
    )
    .unwrap();

    // The note already created a card; we add a sibling via the remote path.
    let remote = vec![RemoteCard {
        id: "c-new".into(),
        note_id: "n2".into(),
        deck_id: "d2".into(),
        card_ord: 99,
        state: "new".into(),
        stability: None,
        difficulty: None,
        last_review: None,
        next_review: None,
        elapsed_days: 0,
        scheduled_days: 0,
        reps: 0,
        lapses: 0,
        suspended: false,
        created_at: 100,
        updated_at: 100,
        deleted_at: None,
    }];

    let stats = apply_cards(&conn, &remote).expect("apply");
    assert_eq!(stats.inserted, 1);

    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM cards WHERE remote_id = 'c-new'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 1);
}

#[test]
fn write_cursor_updates_singleton_row() {
    let db = Database::for_test();
    let conn = db.lock();
    write_cursor(&conn, 1_700_000_000, Some("user-uuid")).expect("write cursor");

    let (ts, uid): (Option<i64>, Option<String>) = conn
        .query_row(
            "SELECT last_sync_at, user_id FROM sync_state WHERE id = 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(ts, Some(1_700_000_000));
    assert_eq!(uid.as_deref(), Some("user-uuid"));
}
