//! SQLite schema migrations.
//!
//! Versioning relies on SQLite's `PRAGMA user_version`. Each future migration
//! bumps the version by 1 and is applied conditionally. Session 1 ships only
//! v1 (the initial schema embedded as `schema.sql`).
//!
//! Migration files are embedded at compile time via `include_str!`, which
//! means the binary is fully self-contained — no external `.sql` to ship.

use rusqlite::Connection;

use crate::error::{AppError, AppResult};

/// Current schema version. Bump when adding a new migration.
pub const CURRENT_VERSION: i32 = 2;

/// Initial schema (v1).
const SCHEMA_V1: &str = include_str!("schema.sql");

/// v2 — extend the `notes.template` CHECK constraint to accept `'occlusion'`.
///
/// SQLite has no `ALTER TABLE … DROP/ADD CONSTRAINT`, so we follow the
/// official "12-step" recipe (simplified — we have no incoming foreign keys
/// pointing AT `notes`):
///
/// 1. Drop the FTS5 helpers (the virtual table + sync triggers) up front;
///    `content=notes` ties the virtual table to the physical one by name.
/// 2. Create `notes_new` with the relaxed CHECK and copy every row.
/// 3. Drop the old `notes` table, rename `notes_new` → `notes`.
/// 4. Recreate the FTS5 virtual table and triggers, then rebuild the index
///    (so existing rows appear in the FTS index even though the triggers
///    weren't installed during the INSERT).
const SCHEMA_V2: &str = r#"
DROP TRIGGER IF EXISTS notes_ai;
DROP TRIGGER IF EXISTS notes_ad;
DROP TRIGGER IF EXISTS notes_au;

DROP TABLE IF EXISTS notes_fts;

CREATE TABLE notes_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    deck_id INTEGER NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
    template TEXT NOT NULL CHECK(template IN ('basic', 'basic_reverse', 'cloze', 'occlusion')),
    fields TEXT NOT NULL,
    tags TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

INSERT INTO notes_new (id, deck_id, template, fields, tags, created_at, updated_at)
SELECT id, deck_id, template, fields, tags, created_at, updated_at FROM notes;

DROP TABLE notes;
ALTER TABLE notes_new RENAME TO notes;

CREATE VIRTUAL TABLE notes_fts USING fts5(
    fields,
    tags,
    content=notes,
    content_rowid=id,
    tokenize='trigram'
);

CREATE TRIGGER notes_ai AFTER INSERT ON notes BEGIN
    INSERT INTO notes_fts(rowid, fields, tags) VALUES (new.id, new.fields, new.tags);
END;

CREATE TRIGGER notes_ad AFTER DELETE ON notes BEGIN
    INSERT INTO notes_fts(notes_fts, rowid, fields, tags) VALUES('delete', old.id, old.fields, old.tags);
END;

CREATE TRIGGER notes_au AFTER UPDATE ON notes BEGIN
    INSERT INTO notes_fts(notes_fts, rowid, fields, tags) VALUES('delete', old.id, old.fields, old.tags);
    INSERT INTO notes_fts(rowid, fields, tags) VALUES (new.id, new.fields, new.tags);
END;

INSERT INTO notes_fts(notes_fts) VALUES('rebuild');
"#;

/// Apply all pending migrations to `conn`.
///
/// Reads `PRAGMA user_version` and applies migrations in order. Each migration
/// is wrapped in a transaction so it either fully succeeds or fully rolls back
/// (the schema file may execute multiple statements via `execute_batch`).
pub fn run(conn: &Connection) -> AppResult<()> {
    let current: i32 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;

    if current == CURRENT_VERSION {
        return Ok(());
    }

    if current > CURRENT_VERSION {
        // Likely a future build was opened on this DB. Refuse to downgrade.
        log::warn!(
            "Database user_version={} is newer than supported version {}. Skipping migrations.",
            current,
            CURRENT_VERSION
        );
        return Ok(());
    }

    // Apply v1 if missing.
    if current < 1 {
        apply_migration(conn, 1, SCHEMA_V1)?;
    }

    // v2 — `notes.template` CHECK now accepts `'occlusion'`.
    if current < 2 {
        apply_migration(conn, 2, SCHEMA_V2)?;
    }

    Ok(())
}

/// Run `sql` inside a transaction and bump `user_version` to `version`.
fn apply_migration(conn: &Connection, version: i32, sql: &str) -> AppResult<()> {
    log::info!("Applying DB migration v{}", version);

    conn.execute_batch("BEGIN;")?;

    if let Err(e) = conn.execute_batch(sql) {
        // Best-effort rollback; if it fails too we still surface the original error.
        let _ = conn.execute_batch("ROLLBACK;");
        return Err(AppError::Database(format!(
            "migration v{} failed: {}",
            version, e
        )));
    }

    // `PRAGMA user_version = ?` does not accept bind params, so format literally.
    // `version` is a hard-coded i32 controlled by this crate — no injection risk.
    conn.execute_batch(&format!("PRAGMA user_version = {};", version))?;
    conn.execute_batch("COMMIT;")?;

    Ok(())
}
