//! Unit tests for the `.apkg` importer.
//!
//! We synthesise minimal `.apkg` archives in-memory rather than checking
//! in binary fixtures. The helper [`build_apkg`] writes a tiny SQLite DB
//! with whatever rows the caller specifies and zips it together with a
//! `media` manifest into a valid `.apkg` byte blob.

use std::io::Write;

use rusqlite::Connection;
use zip::write::SimpleFileOptions;
use zip::CompressionMethod;
use zip::ZipWriter;

use super::converter::convert_to_mnemosys;
use super::parser::parse_apkg;
use crate::db::Database;
use crate::error::AppError;

/// Schema-only SQL string used by every test DB. Mirrors the relevant
/// subset of the Anki collection schema (only columns the parser reads).
const ANKI_SCHEMA: &str = r#"
    CREATE TABLE col (
        id INTEGER PRIMARY KEY,
        decks TEXT NOT NULL,
        models TEXT NOT NULL
    );
    CREATE TABLE notes (
        id INTEGER PRIMARY KEY,
        guid TEXT,
        mid INTEGER NOT NULL,
        mod INTEGER,
        usn INTEGER,
        tags TEXT NOT NULL,
        flds TEXT NOT NULL,
        sfld TEXT,
        csum INTEGER,
        flags INTEGER,
        data TEXT
    );
    CREATE TABLE cards (
        id INTEGER PRIMARY KEY,
        nid INTEGER NOT NULL,
        did INTEGER NOT NULL,
        ord INTEGER NOT NULL,
        mod INTEGER,
        usn INTEGER,
        type INTEGER,
        queue INTEGER,
        due INTEGER,
        ivl INTEGER,
        factor INTEGER,
        reps INTEGER,
        lapses INTEGER,
        left INTEGER,
        odue INTEGER,
        odid INTEGER,
        flags INTEGER,
        data TEXT
    );
"#;

fn unique_tmp(prefix: &str) -> std::path::PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    std::env::temp_dir().join(format!(
        "mnemo_apkg_test_{prefix}_{nanos}_{}.db",
        std::process::id()
    ))
}

/// Build a minimal `.apkg` byte blob from raw SQL inserts.
///
/// `inserts` is appended verbatim after the schema — callers supply
/// `INSERT INTO col / notes / cards VALUES (...)` lines.
fn build_apkg(inserts: &str) -> Vec<u8> {
    let tmp = unique_tmp("build");
    {
        let conn = Connection::open(&tmp).expect("open temp anki db");
        conn.execute_batch(ANKI_SCHEMA).expect("create anki schema");
        conn.execute_batch(inserts).expect("apply test fixtures");
    }
    let db_bytes = std::fs::read(&tmp).expect("read temp db");
    let _ = std::fs::remove_file(&tmp);

    let mut buf = Vec::new();
    {
        let mut zip = ZipWriter::new(std::io::Cursor::new(&mut buf));
        let opts = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

        zip.start_file("collection.anki2", opts).unwrap();
        zip.write_all(&db_bytes).unwrap();

        zip.start_file("media", opts).unwrap();
        zip.write_all(b"{}").unwrap();

        zip.finish().unwrap();
    }
    buf
}

/// `.apkg` with a Basic note (one card) in a single deck. Used as the
/// canonical happy-path fixture across multiple tests.
fn minimal_basic_apkg() -> Vec<u8> {
    let decks = r#"{"1001":{"id":1001,"name":"Test Deck","desc":"Test deck"}}"#;
    let models =
        r#"{"2001":{"id":2001,"name":"Basic","type":0,"flds":[{"name":"Front"},{"name":"Back"}]}}"#;
    let inserts = format!(
        r#"
        INSERT INTO col (id, decks, models) VALUES (1, '{decks}', '{models}');
        INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data)
            VALUES (3001, 'g1', 2001, 0, 0, ' tag1 tag2 ', 'Hello{sep}World', 'Hello', 0, 0, '');
        INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data)
            VALUES (4001, 3001, 1001, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, '');
        "#,
        sep = "\x1f"
    );
    build_apkg(&inserts)
}

// ---------------------------------------------------------------------------
// Parser tests
// ---------------------------------------------------------------------------

#[test]
fn parse_minimal_apkg_extracts_all_sections() {
    let bytes = minimal_basic_apkg();
    let col = parse_apkg(&bytes).expect("parse");

    assert_eq!(col.decks.len(), 1, "expected one deck");
    assert_eq!(col.decks[0].id, 1001);
    assert_eq!(col.decks[0].name, "Test Deck");
    assert_eq!(col.decks[0].description.as_deref(), Some("Test deck"));

    assert_eq!(col.models.len(), 1);
    assert_eq!(col.models[0].name, "Basic");
    assert!(!col.models[0].is_cloze);
    assert_eq!(col.models[0].fields, vec!["Front", "Back"]);

    assert_eq!(col.notes.len(), 1);
    assert_eq!(col.notes[0].fields, vec!["Hello", "World"]);
    assert_eq!(col.notes[0].tags, vec!["tag1", "tag2"]);

    assert_eq!(col.cards.len(), 1);
    assert_eq!(col.cards[0].deck_id, 1001);
    assert_eq!(col.cards[0].note_id, 3001);

    // No media entries in the canonical fixture.
    assert!(col.media.is_empty());
}

#[test]
fn invalid_zip_returns_validation_error() {
    let bytes = b"definitely not a zip";
    let err = parse_apkg(bytes).expect_err("must reject non-zip input");
    assert!(matches!(err, AppError::Validation(_)));
}

#[test]
fn zip_without_collection_returns_validation_error() {
    // Build a ZIP that has *no* collection.anki* entry.
    let mut buf = Vec::new();
    {
        let mut zip = ZipWriter::new(std::io::Cursor::new(&mut buf));
        let opts = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        zip.start_file("media", opts).unwrap();
        zip.write_all(b"{}").unwrap();
        zip.finish().unwrap();
    }
    let err = parse_apkg(&buf).expect_err("must reject zip without collection");
    match err {
        AppError::Validation(msg) => assert!(
            msg.contains("collection.anki2"),
            "unexpected message: {msg}"
        ),
        other => panic!("wrong error variant: {other:?}"),
    }
}

#[test]
fn unsupported_anki21b_returns_clear_error() {
    let mut buf = Vec::new();
    {
        let mut zip = ZipWriter::new(std::io::Cursor::new(&mut buf));
        let opts = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        zip.start_file("collection.anki21b", opts).unwrap();
        // Contents don't matter — the parser rejects on filename presence.
        zip.write_all(b"opaque zstd payload").unwrap();
        zip.finish().unwrap();
    }
    let err = parse_apkg(&buf).expect_err("must reject anki21b");
    match err {
        AppError::Validation(msg) => assert!(
            msg.contains("anki21b") || msg.contains("Support older"),
            "unexpected message: {msg}"
        ),
        other => panic!("wrong error variant: {other:?}"),
    }
}

#[test]
fn media_manifest_is_parsed_when_present() {
    // Build an apkg whose `media` entry actually maps blob ids → filenames.
    let tmp = unique_tmp("media");
    {
        let conn = Connection::open(&tmp).unwrap();
        conn.execute_batch(ANKI_SCHEMA).unwrap();
        let decks = r#"{"1":{"id":1,"name":"Default","desc":""}}"#;
        let models =
            r#"{"2":{"id":2,"name":"Basic","type":0,"flds":[{"name":"Front"},{"name":"Back"}]}}"#;
        conn.execute(
            "INSERT INTO col (id, decks, models) VALUES (1, ?1, ?2)",
            rusqlite::params![decks, models],
        )
        .unwrap();
    }
    let db_bytes = std::fs::read(&tmp).unwrap();
    let _ = std::fs::remove_file(&tmp);

    let mut buf = Vec::new();
    {
        let mut zip = ZipWriter::new(std::io::Cursor::new(&mut buf));
        let opts = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        zip.start_file("collection.anki2", opts).unwrap();
        zip.write_all(&db_bytes).unwrap();
        zip.start_file("media", opts).unwrap();
        zip.write_all(br#"{"0":"front.jpg","1":"audio.mp3"}"#)
            .unwrap();
        zip.finish().unwrap();
    }

    let col = parse_apkg(&buf).expect("parse");
    assert_eq!(col.media.len(), 2);
    assert_eq!(col.media.get("0").map(String::as_str), Some("front.jpg"));
    assert_eq!(col.media.get("1").map(String::as_str), Some("audio.mp3"));
}

// ---------------------------------------------------------------------------
// Converter tests
// ---------------------------------------------------------------------------

#[test]
fn convert_basic_apkg_into_fresh_db() {
    let bytes = minimal_basic_apkg();
    let col = parse_apkg(&bytes).unwrap();
    let db = Database::for_test();

    let result = convert_to_mnemosys(&db, col).expect("convert");
    assert_eq!(result.stats.decks_imported, 1);
    assert_eq!(result.stats.notes_imported, 1);
    assert_eq!(result.stats.notes_skipped, 0);
    assert_eq!(result.stats.cards_skipped_no_anki_card, 0);
    assert!(result.skipped_decks.is_empty());

    let conn = db.lock();
    let decks = db.decks(&conn).list().unwrap();
    assert_eq!(decks.len(), 1);
    assert_eq!(decks[0].name, "Test Deck");

    // Mnemosys materialises one card per Basic note.
    let cards: i64 = conn
        .query_row("SELECT COUNT(*) FROM cards", [], |r| r.get(0))
        .unwrap();
    assert_eq!(cards, 1);
}

#[test]
fn convert_skips_decks_with_existing_names() {
    let bytes = minimal_basic_apkg();
    let col = parse_apkg(&bytes).unwrap();

    let db = Database::for_test();
    {
        let conn = db.lock();
        db.decks(&conn)
            .create("Test Deck", None, "#3b82f6", 0.9, None, None, None)
            .unwrap();
    }

    let result = convert_to_mnemosys(&db, col).expect("convert");
    assert_eq!(result.skipped_decks, vec!["Test Deck".to_string()]);
    assert_eq!(result.stats.decks_imported, 0);
    // Note couldn't land because parent deck was skipped.
    assert_eq!(result.stats.notes_imported, 0);
    assert_eq!(result.stats.notes_skipped, 1);
}

#[test]
fn convert_handles_cloze_model() {
    let decks = r#"{"1100":{"id":1100,"name":"Cloze Deck","desc":""}}"#;
    let models =
        r#"{"2100":{"id":2100,"name":"Cloze","type":1,"flds":[{"name":"Text"},{"name":"Extra"}]}}"#;
    let cloze_text = "The capital of {{c1::France}} is {{c2::Paris}}";
    let inserts = format!(
        r#"
        INSERT INTO col (id, decks, models) VALUES (1, '{decks}', '{models}');
        INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data)
            VALUES (3100, 'g2', 2100, 0, 0, '', '{cloze_text}{sep}', '{cloze_text}', 0, 0, '');
        INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data)
            VALUES (4100, 3100, 1100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, '');
        "#,
        sep = "\x1f"
    );
    let bytes = build_apkg(&inserts);

    let col = parse_apkg(&bytes).unwrap();
    let db = Database::for_test();
    let result = convert_to_mnemosys(&db, col).unwrap();

    assert_eq!(result.stats.decks_imported, 1);
    assert_eq!(result.stats.notes_imported, 1, "cloze note should land");

    let conn = db.lock();
    // Cloze with c1+c2 yields 2 Mnemosys cards.
    let cards: i64 = conn
        .query_row("SELECT COUNT(*) FROM cards", [], |r| r.get(0))
        .unwrap();
    assert_eq!(cards, 2, "expected one card per cloze ordinal");
}

#[test]
fn convert_handles_basic_reverse_model() {
    let decks = r#"{"1200":{"id":1200,"name":"Reverse Deck","desc":""}}"#;
    let models = r#"{"2200":{"id":2200,"name":"Basic (and reversed card)","type":0,"flds":[{"name":"Front"},{"name":"Back"}]}}"#;
    let inserts = format!(
        r#"
        INSERT INTO col (id, decks, models) VALUES (1, '{decks}', '{models}');
        INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data)
            VALUES (3200, 'g3', 2200, 0, 0, '', 'hola{sep}hello', 'hola', 0, 0, '');
        INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data)
            VALUES (4200, 3200, 1200, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, '');
        "#,
        sep = "\x1f"
    );
    let bytes = build_apkg(&inserts);

    let col = parse_apkg(&bytes).unwrap();
    let db = Database::for_test();
    let result = convert_to_mnemosys(&db, col).unwrap();
    assert_eq!(result.stats.notes_imported, 1);

    let conn = db.lock();
    // BasicReverse note yields 2 cards (front→back + back→front).
    let cards: i64 = conn
        .query_row("SELECT COUNT(*) FROM cards", [], |r| r.get(0))
        .unwrap();
    assert_eq!(cards, 2);
}

#[test]
fn convert_skips_notes_with_empty_fields() {
    // Anki technically allows blank `flds`; Mnemosys' NoteRepo refuses them.
    // The importer must absorb the validation error rather than aborting.
    let decks = r#"{"1300":{"id":1300,"name":"Blanky","desc":""}}"#;
    let models =
        r#"{"2300":{"id":2300,"name":"Basic","type":0,"flds":[{"name":"Front"},{"name":"Back"}]}}"#;
    let inserts = format!(
        r#"
        INSERT INTO col (id, decks, models) VALUES (1, '{decks}', '{models}');
        INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data)
            VALUES (3300, 'g4', 2300, 0, 0, '', '{sep}', '', 0, 0, '');
        INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data)
            VALUES (4300, 3300, 1300, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, '');
        "#,
        sep = "\x1f"
    );
    let bytes = build_apkg(&inserts);
    let col = parse_apkg(&bytes).unwrap();
    let db = Database::for_test();
    let result = convert_to_mnemosys(&db, col).unwrap();

    assert_eq!(result.stats.decks_imported, 1);
    assert_eq!(result.stats.notes_imported, 0);
    assert_eq!(
        result.stats.notes_skipped, 1,
        "empty field note must be skipped"
    );
}

#[test]
fn convert_counts_orphan_notes_separately() {
    // Note 3400 has no matching card row → orphan.
    let decks = r#"{"1400":{"id":1400,"name":"Orphan Deck","desc":""}}"#;
    let models =
        r#"{"2400":{"id":2400,"name":"Basic","type":0,"flds":[{"name":"Front"},{"name":"Back"}]}}"#;
    let inserts = format!(
        r#"
        INSERT INTO col (id, decks, models) VALUES (1, '{decks}', '{models}');
        INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data)
            VALUES (3400, 'g5', 2400, 0, 0, '', 'lone{sep}note', 'lone', 0, 0, '');
        "#,
        sep = "\x1f"
    );
    let bytes = build_apkg(&inserts);
    let col = parse_apkg(&bytes).unwrap();
    let db = Database::for_test();
    let result = convert_to_mnemosys(&db, col).unwrap();
    assert_eq!(result.stats.cards_skipped_no_anki_card, 1);
    assert_eq!(result.stats.notes_imported, 0);
}

#[test]
fn convert_skips_anki_default_deck() {
    // Anki's built-in Default deck (id=1) is silently dropped so we don't
    // collide with a user's existing inbox.
    let decks = r#"{"1":{"id":1,"name":"Default","desc":""},"1500":{"id":1500,"name":"Real Deck","desc":""}}"#;
    let models =
        r#"{"2500":{"id":2500,"name":"Basic","type":0,"flds":[{"name":"Front"},{"name":"Back"}]}}"#;
    let inserts = format!(
        r#"
        INSERT INTO col (id, decks, models) VALUES (1, '{decks}', '{models}');
        INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data)
            VALUES (3500, 'g6', 2500, 0, 0, '', 'a{sep}b', 'a', 0, 0, '');
        INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data)
            VALUES (4500, 3500, 1500, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, '');
        "#,
        sep = "\x1f"
    );
    let bytes = build_apkg(&inserts);
    let col = parse_apkg(&bytes).unwrap();
    let db = Database::for_test();
    let result = convert_to_mnemosys(&db, col).unwrap();
    assert_eq!(result.stats.decks_imported, 1);

    let conn = db.lock();
    let names: Vec<String> = db
        .decks(&conn)
        .list()
        .unwrap()
        .into_iter()
        .map(|d| d.name)
        .collect();
    assert!(names.contains(&"Real Deck".to_string()));
    assert!(!names.contains(&"Default".to_string()));
}
