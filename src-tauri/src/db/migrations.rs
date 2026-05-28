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
pub const CURRENT_VERSION: i32 = 11;

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

/// v3 — Session 3 cloud sync scaffolding.
///
/// Adds a nullable `remote_id TEXT` column to `decks`, `notes`, `cards`. The
/// column stores the UUID assigned by the Supabase backend so the local row
/// can be mapped to its remote counterpart across devices. A `NULL` value
/// means « not synced yet ». A unique index lets us upsert by `remote_id`
/// without scanning.
///
/// Also creates `sync_state`, a singleton table (`CHECK(id = 1)`) holding the
/// last successful sync timestamp and the active `user_id`. This row is the
/// cursor for the delta-based sync cycle described in
/// `docs/SESSION_3_SYNC.md`.
///
/// SQLite caveat: `ALTER TABLE ADD COLUMN` is supported and idempotent only
/// if we guard against re-adding the column on a partially-migrated DB. The
/// migration runner uses `PRAGMA user_version` to skip already-applied
/// migrations, so the `ALTER` runs exactly once per upgrade.
const SCHEMA_V3: &str = r#"
ALTER TABLE decks ADD COLUMN remote_id TEXT;
ALTER TABLE notes ADD COLUMN remote_id TEXT;
ALTER TABLE cards ADD COLUMN remote_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_decks_remote_id ON decks(remote_id) WHERE remote_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_notes_remote_id ON notes(remote_id) WHERE remote_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_cards_remote_id ON cards(remote_id) WHERE remote_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS sync_state (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    last_sync_at INTEGER,
    user_id TEXT
);

INSERT OR IGNORE INTO sync_state (id, last_sync_at, user_id) VALUES (1, NULL, NULL);
"#;

/// v4 — White Hat gamification primitives (Vague 1).
///
/// - `user_stats` is a singleton row (`CHECK(id = 1)`) tracking the current /
///   best streak, the last day a review was logged, monthly freeze inventory
///   (resets when `freeze_month` no longer matches the current `YYYY-MM`), and
///   lifetime review counters.
/// - `achievements` records badges earned by the learner. `code` is a unique
///   string slug (`streak_7`, `first_review`, …); `INSERT OR IGNORE` on the
///   `code` constraint makes unlocking idempotent.
///
/// White Hat principle: every column is **positive reinforcement**. No
/// punitive timers, no XP debts, no public leaderboard.
const SCHEMA_V4: &str = include_str!("schema_v4.sql");

/// v5 — Cognitive features (Vague 2): metacognitive confidence rating.
///
/// Adds an optional `confidence INTEGER` column to `reviews`. Values lie in
/// `[1, 5]` (CBM — Gardner-Medwin's confidence-based marking) and are
/// captured BEFORE the user picks the FSRS rating, so the two signals stay
/// orthogonal: confidence reflects what the learner *thinks* they know,
/// rating reflects what they *actually* answered.
///
/// NULL is intentionally allowed so the column is forward-compatible: any
/// review logged before v5 keeps a NULL confidence and reviews from a
/// session where the toggle is off do too.
const SCHEMA_V5: &str = include_str!("schema_v5.sql");

/// v6 — Neuro modes (Vague 3): optional wellness tracking.
///
/// Adds a `wellness_logs` table capturing pre-session mood, sleep hours,
/// stress level, and two simple boolean flags (hydrated, caffeine taken).
/// Every value column is NULL-able by design — skipping the check-in is a
/// first-class flow, not a degenerate case. The opt-in master switch lives
/// in `AppSettings.neuro_modes_enabled`; until the learner enables it,
/// nothing writes to this table.
///
/// Sourced evidence: Spiegel et al., Cell Reports Medicine 2023
/// (cyclic sighing); Roig et al., acute exercise & memory consolidation
/// (d≈0.52); sleep deprivation meta-analysis (g≈0.621).
const SCHEMA_V6: &str = include_str!("schema_v6.sql");

/// v8 — Drawing effect (Vague 7): optional per-review sketch storage.
///
/// Wammes et al. 2016/2018 measured a 30-50% recall boost when learners
/// sketch their guess BEFORE seeing the answer. The table is keyed by
/// `review_id` so each persisted review has at most one sketch, and is
/// linked back to `cards(id)` for cheap « show me past sketches for
/// this card » lookups.
const SCHEMA_V8: &str = include_str!("schema_v8.sql");

/// v9 — Delayed Judgments of Learning (Vague 7): metacognitive calibration.
///
/// Rhodes & Tauber 2011 meta-analysis (4554 subjects) reports a γ ≈ 0.93
/// effect size on resolution of delayed JOLs. Stores one prediction per
/// learner self-rating event; `resolve_prediction` flips `actual_correct`
/// at the next review and the calibration dashboard derives γ, bias and
/// per-confidence-band buckets from there.
const SCHEMA_V9: &str = include_str!("schema_v9.sql");

/// v10 — Memory Palace 3D Builder (Vague 9): method-of-loci spatial review.
///
/// Adds `palaces` (one row per palace, e.g. « ma maison d'enfance »,
/// with a 3D template — house / street / castle / custom) and
/// `palace_loci` (one row per card-locus pin, with (x, y, z) and a
/// traversal `ordinal`). The traversal order is the walking path the
/// learner takes during review mode. Krokos et al. 2019 (Virtual
/// Reality 23) reports a +8.8 % recall improvement vs flat lists,
/// rooted in the place/grid-cell circuitry behind episodic memory
/// (Nobel 2014, O'Keefe & Moser).
const SCHEMA_V10: &str = include_str!("schema_v10.sql");

/// v11 — Vague 10 Mode Langue: sentence + bidirectional templates and
/// optional `frequency_band` tagging.
///
/// Two coupled changes:
///   1. Extend the `notes.template` CHECK constraint with `'sentence'`
///      (one card, source→target) and `'bidirectional'` (two cards, the
///      Lampariello pattern: source→target and target→source).
///   2. Add a nullable `frequency_band TEXT` column to `notes`. Bucket
///      values come from the Zipf-flavoured corpus tiers `top_100`,
///      `top_1k`, `top_5k`, `top_10k`, `beyond`. NULL = un-tagged.
///
/// Like v2, we follow the SQLite 12-step recipe (drop FTS5, rebuild
/// `notes`, recreate FTS5 + triggers, rebuild the index) so the new
/// CHECK constraint and the new column land in a single migration
/// without leaving the FTS index in an inconsistent state.
const SCHEMA_V11: &str = include_str!("schema_v11.sql");

/// v7 — Pluggable schedulers (Vague 4): per-deck algorithm choice.
///
/// Adds a `scheduler_kind` column to `decks` storing one of `'fsrs6'`
/// (default, the existing FSRS-6 engine), `'sm2'` (the classic Anki
/// SuperMemo-2 algorithm) or `'leitner'` (5-box Leitner system). The
/// CHECK constraint pins the accepted values so an out-of-band write
/// (e.g. a manual SQL session) cannot wedge the scheduler dispatcher.
///
/// `ALTER TABLE … ADD COLUMN` cannot embed a CHECK constraint pointing at
/// the *new* column on SQLite, so we apply the constraint at the column
/// level via the standard 12-step recipe: build a new table, copy rows,
/// swap names. Foreign keys pointing at `decks(id)` survive because the
/// rowids stay the same when we COPY with explicit `id`.
const SCHEMA_V7: &str = r#"
-- We follow the 12-step recipe instead of plain ALTER TABLE because we
-- want a CHECK constraint on the new column. `decks` has incoming FKs
-- from `notes` and `cards`; with `foreign_keys=ON` we must defer the FK
-- check inside this transaction or copy rows with the same primary keys
-- (which we do). `defer_foreign_keys=ON` is the cleanest hammer.
PRAGMA defer_foreign_keys = ON;

CREATE TABLE decks_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    color TEXT NOT NULL DEFAULT '#3b82f6',
    desired_retention REAL NOT NULL DEFAULT 0.9,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    remote_id TEXT,
    scheduler_kind TEXT NOT NULL DEFAULT 'fsrs6'
        CHECK(scheduler_kind IN ('fsrs6', 'sm2', 'leitner'))
);

INSERT INTO decks_new (id, name, description, color, desired_retention,
                       created_at, updated_at, remote_id, scheduler_kind)
SELECT id, name, description, color, desired_retention,
       created_at, updated_at, remote_id, 'fsrs6'
FROM decks;

DROP TABLE decks;
ALTER TABLE decks_new RENAME TO decks;

-- The unique index on remote_id was dropped together with the old table;
-- recreate it from the v3 spec.
CREATE UNIQUE INDEX IF NOT EXISTS idx_decks_remote_id
    ON decks(remote_id) WHERE remote_id IS NOT NULL;
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

    // v3 — sync scaffolding (`remote_id` columns + `sync_state` table).
    if current < 3 {
        apply_migration(conn, 3, SCHEMA_V3)?;
    }

    // v4 — Vague 1 gamification (`user_stats` singleton + `achievements`).
    if current < 4 {
        apply_migration(conn, 4, SCHEMA_V4)?;
    }

    // v5 — Vague 2 cognitive: optional `confidence` column on `reviews`.
    if current < 5 {
        apply_migration(conn, 5, SCHEMA_V5)?;
    }

    // v6 — Vague 3 neuro: optional `wellness_logs` table.
    if current < 6 {
        apply_migration(conn, 6, SCHEMA_V6)?;
    }

    // v7 — Vague 4 pluggable schedulers: per-deck `scheduler_kind` column.
    if current < 7 {
        apply_migration(conn, 7, SCHEMA_V7)?;
    }

    // v8 — Vague 7 drawing effect: optional `review_sketches` table.
    if current < 8 {
        apply_migration(conn, 8, SCHEMA_V8)?;
    }

    // v9 — Vague 7 delayed JOLs: `jol_predictions` table for calibration.
    if current < 9 {
        apply_migration(conn, 9, SCHEMA_V9)?;
    }

    // v10 — Vague 9 Memory Palace: `palaces` + `palace_loci` tables.
    if current < 10 {
        apply_migration(conn, 10, SCHEMA_V10)?;
    }

    // v11 — Vague 10 Mode Langue: extend templates CHECK + add `frequency_band`.
    if current < 11 {
        apply_migration(conn, 11, SCHEMA_V11)?;
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

#[cfg(test)]
mod tests {
    use super::*;

    /// `Database::for_test` runs every migration. v3 must surface
    /// `remote_id` on the three content tables and seed a single
    /// `sync_state` row.
    #[test]
    fn migrations_apply_v3_columns_and_state() {
        let db = crate::db::Database::for_test();
        let conn = db.lock();

        let user_version: i32 = conn
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .expect("read user_version");
        assert_eq!(user_version, CURRENT_VERSION);

        // Each of decks/notes/cards must have a `remote_id` column.
        for table in ["decks", "notes", "cards"] {
            let mut stmt = conn
                .prepare(&format!("PRAGMA table_info({})", table))
                .expect("prepare table_info");
            let cols: Vec<String> = stmt
                .query_map([], |r| r.get::<_, String>(1))
                .expect("query")
                .filter_map(Result::ok)
                .collect();
            assert!(
                cols.iter().any(|c| c == "remote_id"),
                "{} should have a remote_id column",
                table
            );
        }

        // Singleton `sync_state` row exists with NULL last_sync_at.
        let (row_id, last_sync_at, user_id): (i64, Option<i64>, Option<String>) = conn
            .query_row(
                "SELECT id, last_sync_at, user_id FROM sync_state WHERE id = 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .expect("sync_state singleton must exist");
        assert_eq!(row_id, 1);
        assert!(last_sync_at.is_none());
        assert!(user_id.is_none());
    }

    /// Re-running migrations on an already-up-to-date connection is a no-op
    /// and never explodes (idempotence guard for the in-process upgrade flow).
    #[test]
    fn migrations_are_idempotent() {
        let db = crate::db::Database::for_test();
        let conn = db.lock();
        run(&conn).expect("second run should be a no-op");
    }
}
