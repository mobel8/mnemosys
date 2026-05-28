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
pub const CURRENT_VERSION: i32 = 16;

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

/// v12 — Vague 14 Modes disciplinaires: two new structured note templates.
///
/// Extends the `notes.template` CHECK constraint with `'illness_script'`
/// (médecine, Charlin 2007 — one card, condition → four clinical sections)
/// and `'refutation'` (sciences, Tippett 2010 meta — one card confronting a
/// misconception). Like v2 / v11, we follow the SQLite 12-step recipe (drop
/// FTS5, rebuild `notes`, recreate FTS5 + triggers, rebuild the index) so the
/// new CHECK lands without leaving the FTS index inconsistent. Every column —
/// `remote_id` and `frequency_band` included — is copied across verbatim.
const SCHEMA_V12: &str = include_str!("schema_v12.sql");

/// v13 — Vague 15: maths worked-example template + mastery gating + two-step
/// retrospective confidence. A single migration carrying three coupled
/// changes:
///   1. Extend the `notes.template` CHECK constraint with `'worked_example'`
///      (maths, Sweller/Renkl/Atkinson 2003 — one card with progressively
///      revealed solution steps). Follows the SQLite 12-step recipe (drop
///      FTS5, rebuild `notes`, recreate FTS5 + triggers, rebuild the index)
///      so the new CHECK lands without leaving the FTS index inconsistent;
///      `remote_id` and `frequency_band` are copied verbatim.
///   2. Add a nullable `prerequisite_deck_id INTEGER REFERENCES decks(id)`
///      column to `decks` (Bloom mastery learning — a deck unlocks once its
///      prerequisite hits ≥90 % retention over 30 days with ≥20 reviews).
///   3. Add a nullable `confidence_post INTEGER` column to `reviews`
///      (Bang & Fleming 2018 — retrospective confidence captured AFTER the
///      answer, complementing the prospective `confidence` column from v5).
const SCHEMA_V13: &str = include_str!("schema_v13.sql");

/// v14 — Reading Import (Vague 17): LingQ-style per-word knowledge tracking.
///
/// Adds a single `word_status` table keyed by the composite `(word,
/// language)` so the same spelling can carry an independent status across
/// language decks. `status` is constrained to `new` / `learning` / `known`;
/// the absence of a row is treated as `new` by the UI. Pure additive
/// `CREATE TABLE IF NOT EXISTS` — no `notes` rebuild, no data migration.
const SCHEMA_V14: &str = include_str!("schema_v14.sql");

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

/// v15 — Vague 20 advanced schedulers: widen the `decks.scheduler_kind`
/// CHECK constraint to accept `'hlr'` (Half-Life Regression, Settles &
/// Meeder 2016) and `'memorize'` (optimal-control spacing, Tabibian et al.
/// 2019).
///
/// As in v7, SQLite has no `ALTER … DROP/ADD CONSTRAINT`, so we rebuild
/// `decks` via the 12-step recipe. Two columns were added after v7 by plain
/// `ALTER TABLE ADD COLUMN` (v11's `language_mode`, v13's
/// `prerequisite_deck_id`); both are carried across verbatim and the column
/// ORDER matches the live table so `row_to_deck`'s positional `get(n)` keeps
/// working. Existing decks keep their `scheduler_kind` value (we copy the
/// column rather than resetting it).
const SCHEMA_V15: &str = r#"
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
        CHECK(scheduler_kind IN ('fsrs6', 'sm2', 'leitner', 'hlr', 'memorize')),
    language_mode TEXT,
    prerequisite_deck_id INTEGER REFERENCES decks(id)
);

INSERT INTO decks_new (id, name, description, color, desired_retention,
                       created_at, updated_at, remote_id, scheduler_kind,
                       language_mode, prerequisite_deck_id)
SELECT id, name, description, color, desired_retention,
       created_at, updated_at, remote_id, scheduler_kind,
       language_mode, prerequisite_deck_id
FROM decks;

DROP TABLE decks;
ALTER TABLE decks_new RENAME TO decks;

CREATE UNIQUE INDEX IF NOT EXISTS idx_decks_remote_id
    ON decks(remote_id) WHERE remote_id IS NOT NULL;
"#;

/// v16 — Vague 21 Implementation Intentions (Gollwitzer 1999, d≈0.65).
///
/// Adds a single `study_plans` table storing « si [trigger] alors [action] »
/// study-cue plans. `trigger_type` is one of `time` (a `HH:MM` clock cue),
/// `place` (a location label) or `after_habit` (an existing routine). The
/// CHECK pins the accepted values so a misbehaving UI can't wedge the
/// notification scheduler, which only fires for `time` plans.
///
/// `days` is a JSON array of ISO weekday ints (`1`=Mon … `7`=Sun); an empty
/// array `[]` means « every day ». `deck_id` is an optional soft reference to
/// the deck the plan reviews — it is intentionally NOT a foreign key so
/// deleting a deck never silently drops the learner's plan (the UI degrades
/// to a plain action label). Pure additive `CREATE TABLE IF NOT EXISTS` — no
/// table rebuild, no data migration.
const SCHEMA_V16: &str = r#"
CREATE TABLE IF NOT EXISTS study_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trigger_type TEXT NOT NULL
        CHECK(trigger_type IN ('time', 'place', 'after_habit')),
    trigger_value TEXT NOT NULL,
    action TEXT NOT NULL,
    deck_id INTEGER,
    days TEXT NOT NULL DEFAULT '[]',
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
);
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

    // v12 — Vague 14 Modes disciplinaires: extend templates CHECK with
    // `illness_script` + `refutation`.
    if current < 12 {
        apply_migration(conn, 12, SCHEMA_V12)?;
    }

    // v13 — Vague 15: `worked_example` template CHECK rebuild +
    // `prerequisite_deck_id` on decks + `confidence_post` on reviews.
    if current < 13 {
        apply_migration(conn, 13, SCHEMA_V13)?;
    }

    // v14 — Vague 17 Reading Import: `word_status` table.
    if current < 14 {
        apply_migration(conn, 14, SCHEMA_V14)?;
    }

    // v15 — Vague 20 advanced schedulers: widen `decks.scheduler_kind` CHECK
    // to accept `'hlr'` + `'memorize'`.
    if current < 15 {
        apply_migration(conn, 15, SCHEMA_V15)?;
    }

    // v16 — Vague 21 Implementation Intentions: `study_plans` table.
    if current < 16 {
        apply_migration(conn, 16, SCHEMA_V16)?;
    }

    Ok(())
}

/// Run `sql` inside a transaction and bump `user_version` to `version`.
///
/// CRITICAL — foreign keys are disabled for the duration of the migration.
/// Several migrations rebuild a table via the SQLite "12-step recipe"
/// (`CREATE table_new` → `INSERT … SELECT` → `DROP TABLE table` →
/// `ALTER … RENAME`). With `foreign_keys = ON`, the `DROP TABLE notes` /
/// `DROP TABLE decks` step fires every child `ON DELETE CASCADE`, silently
/// wiping `cards` + `reviews` (and `notes` when rebuilding `decks`) before
/// the rows are copied back. `PRAGMA defer_foreign_keys` does NOT help — it
/// only defers constraint *checking*, not the CASCADE *action*. And the
/// pragma cannot be toggled inside a transaction. So we disable FKs BEFORE
/// `BEGIN` and restore them AFTER `COMMIT`, exactly as recommended by
/// <https://www.sqlite.org/lang_altertable.html> ("Making Other Kinds Of
/// Table Schema Changes"). `Database::new` re-asserts `foreign_keys = ON`
/// for normal operation; this only relaxes it during the migration window.
fn apply_migration(conn: &Connection, version: i32, sql: &str) -> AppResult<()> {
    log::info!("Applying DB migration v{}", version);

    // Must happen OUTSIDE any transaction (SQLite ignores the pragma inside one).
    conn.pragma_update(None, "foreign_keys", "OFF")?;

    conn.execute_batch("BEGIN;")?;

    if let Err(e) = conn.execute_batch(sql) {
        // Best-effort rollback; if it fails too we still surface the original error.
        let _ = conn.execute_batch("ROLLBACK;");
        let _ = conn.pragma_update(None, "foreign_keys", "ON");
        return Err(AppError::Database(format!(
            "migration v{} failed: {}",
            version, e
        )));
    }

    // `PRAGMA user_version = ?` does not accept bind params, so format literally.
    // `version` is a hard-coded i32 controlled by this crate — no injection risk.
    conn.execute_batch(&format!("PRAGMA user_version = {};", version))?;
    conn.execute_batch("COMMIT;")?;

    // Restore enforcement for normal operation. A post-migration integrity
    // sweep would surface any dangling reference introduced by the rebuild.
    conn.pragma_update(None, "foreign_keys", "ON")?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Regression guard for the foreign-key CASCADE data-loss bug: upgrading
    /// a DB that already holds data must NOT wipe FK-linked child rows when a
    /// migration rebuilds `notes` or `decks`. Boots a DB at v1, seeds a full
    /// deck→note→card→review chain, then replays v2..=CURRENT and asserts
    /// every row survives. (Pre-fix this asserted (1,0,0,0).)
    #[test]
    fn rebuild_migrations_preserve_existing_data() {
        let conn = rusqlite::Connection::open_in_memory().expect("open in-memory");
        // Bootstrap at v1 only — then replay the rest through `run`.
        apply_migration(&conn, 1, SCHEMA_V1).expect("apply v1");

        conn.execute_batch(
            "INSERT INTO decks (name, color, desired_retention, created_at, updated_at)
               VALUES ('Deck', '#000000', 0.9, 0, 0);
             INSERT INTO notes (deck_id, template, fields, tags, created_at, updated_at)
               VALUES (1, 'basic', '{\"front\":\"q\",\"back\":\"a\"}', '[]', 0, 0);
             INSERT INTO cards (note_id, deck_id, card_ord, state, created_at, updated_at)
               VALUES (1, 1, 0, 'review', 0, 0);
             INSERT INTO reviews (card_id, rating, state_before, state_after,
                                  stability_after, difficulty_after, elapsed_days,
                                  scheduled_days, review_time, reviewed_at)
               VALUES (1, 3, 'new', 'review', 2.0, 5.0, 0, 2, 1000, 0);",
        )
        .expect("seed v1 data");

        run(&conn).expect("replay migrations v2..=CURRENT");

        let count = |table: &str| -> i64 {
            conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
                .unwrap_or(-1)
        };
        assert_eq!(count("decks"), 1, "deck wiped by a table-rebuild migration");
        assert_eq!(count("notes"), 1, "note wiped by a table-rebuild migration");
        assert_eq!(count("cards"), 1, "card wiped by a table-rebuild migration");
        assert_eq!(
            count("reviews"),
            1,
            "review history wiped by a table-rebuild migration"
        );

        // FK enforcement must be back ON after migrations complete.
        let fk: i64 = conn
            .pragma_query_value(None, "foreign_keys", |r| r.get(0))
            .expect("read foreign_keys pragma");
        assert_eq!(fk, 1, "foreign_keys must be re-enabled after migrations");
    }

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

    /// v15 widened the `decks.scheduler_kind` CHECK: the two Vague 20
    /// algorithms must now be storable, while bogus values stay rejected.
    #[test]
    fn migration_v15_allows_hlr_and_memorize() {
        let db = crate::db::Database::for_test();
        let conn = db.lock();
        let now = chrono::Utc::now().timestamp();

        for kind in ["fsrs6", "sm2", "leitner", "hlr", "memorize"] {
            conn.execute(
                "INSERT INTO decks (name, color, desired_retention, scheduler_kind, created_at, updated_at)
                 VALUES (?1, '#3b82f6', 0.9, ?2, ?3, ?3)",
                rusqlite::params![format!("deck-{kind}"), kind, now],
            )
            .unwrap_or_else(|e| panic!("scheduler_kind '{kind}' must satisfy the CHECK: {e}"));
        }

        // A value outside the widened set is still rejected by the CHECK.
        let bad = conn.execute(
            "INSERT INTO decks (name, color, desired_retention, scheduler_kind, created_at, updated_at)
             VALUES ('bad', '#3b82f6', 0.9, 'anki21', ?1, ?1)",
            rusqlite::params![now],
        );
        assert!(bad.is_err(), "unknown scheduler_kind must violate the CHECK");
    }
}
