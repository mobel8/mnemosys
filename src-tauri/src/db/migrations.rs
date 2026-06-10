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
pub const CURRENT_VERSION: i32 = 19;

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
/// effect size on resolution of delayed JOLs. Stored one prediction per
/// learner self-rating event, resolved against the next review.
///
/// v0.11 — the JOL pipeline was removed (calibration now derives from
/// `reviews.confidence`, see `db/metacognition.rs`); the `jol_predictions`
/// table stays in the schema, inert, so historical rows survive and the
/// migration chain stays append-only.
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

/// v17 — Referential-integrity hardening for the `decks → {decks, cards}`
/// relationships. Three coupled changes, all about making FK behaviour
/// explicit instead of relying on application code:
///
///   1. `decks.prerequisite_deck_id` gains `ON DELETE SET NULL`. A deck used
///      as another deck's mastery prerequisite could not be deleted before
///      (the self-referential FK had no ON DELETE action, so SQLite aborted
///      the DELETE with a constraint violation). Semantics: deleting a
///      prerequisite simply *dissolves the gate* — the dependent deck becomes
///      ungated rather than blocking the deletion.
///   2. `cards.deck_id` gains `ON DELETE CASCADE`. Previously `notes.deck_id`
///      cascaded (so a deck delete removed its notes, which cascaded to their
///      cards via `cards.note_id`), but `cards.deck_id` itself had no action.
///      The cascade chain happened to clean up cards, but the explicit action
///      makes the intent unambiguous and robust to any future card that is
///      not tied to a note in the same deck.
///   3. New `idx_notes_deck` index on `notes(deck_id)` — the deck-detail and
///      deletion paths filter notes by `deck_id`, and the FK cascade scans it.
///
/// Both `decks` and `cards` are rebuilt with the SQLite 12-step recipe because
/// `ALTER TABLE` cannot add/alter a FOREIGN KEY action. Column ORDER is
/// preserved verbatim so the positional `row_to_deck` / `row_to_card` readers
/// keep working. `decks` is rebuilt first; because `cards.deck_id` references
/// `decks(id)`, rebuilding `decks` would normally trip the cards FK, but the
/// migration runner disables `foreign_keys` for the whole window and runs a
/// `PRAGMA foreign_key_check` before COMMIT to catch any orphan it created.
const SCHEMA_V17: &str = r#"
PRAGMA defer_foreign_keys = ON;

-- ---- (1) decks rebuild: ON DELETE SET NULL on prerequisite_deck_id ---------

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
    prerequisite_deck_id INTEGER REFERENCES decks(id) ON DELETE SET NULL
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

-- ---- (2) cards rebuild: ON DELETE CASCADE on deck_id -----------------------

CREATE TABLE cards_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    deck_id INTEGER NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
    card_ord INTEGER NOT NULL DEFAULT 0,
    state TEXT NOT NULL DEFAULT 'new' CHECK(state IN ('new', 'learning', 'review', 'relearning')),
    stability REAL,
    difficulty REAL,
    last_review INTEGER,
    next_review INTEGER,
    elapsed_days INTEGER NOT NULL DEFAULT 0,
    scheduled_days INTEGER NOT NULL DEFAULT 0,
    reps INTEGER NOT NULL DEFAULT 0,
    lapses INTEGER NOT NULL DEFAULT 0,
    suspended INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    remote_id TEXT
);

INSERT INTO cards_new (id, note_id, deck_id, card_ord, state, stability,
                       difficulty, last_review, next_review, elapsed_days,
                       scheduled_days, reps, lapses, suspended, created_at,
                       updated_at, remote_id)
SELECT id, note_id, deck_id, card_ord, state, stability,
       difficulty, last_review, next_review, elapsed_days,
       scheduled_days, reps, lapses, suspended, created_at,
       updated_at, remote_id
FROM cards;

DROP TABLE cards;
ALTER TABLE cards_new RENAME TO cards;

-- Recreate the indexes that died with the old `cards` table (v1 + v3).
CREATE INDEX idx_cards_due ON cards(next_review) WHERE suspended = 0;
CREATE INDEX idx_cards_deck ON cards(deck_id);
CREATE INDEX idx_cards_state ON cards(state) WHERE suspended = 0;
CREATE UNIQUE INDEX IF NOT EXISTS idx_cards_remote_id
    ON cards(remote_id) WHERE remote_id IS NOT NULL;

-- ---- (3) deck → note lookup index ------------------------------------------

CREATE INDEX IF NOT EXISTS idx_notes_deck ON notes(deck_id);
"#;

// v18 — P018: composite covering index for the per-deck due query (deck filter
// + next_review range) so a study session does a SEARCH on a covering index
// instead of a cross-deck scan + temp B-tree.
const SCHEMA_V18: &str =
    "CREATE INDEX IF NOT EXISTS idx_cards_due_deck ON cards(deck_id, next_review) WHERE suspended = 0;";

/// v19 — restructure/v0.11: FSRS-6 becomes the **only** scheduler.
///
/// The pluggable per-deck algorithms (SM-2 / Leitner from Vague 4, HLR /
/// MEMORIZE from Vague 20) are removed from the codebase; every deck is
/// scheduled by FSRS-6 from now on. This is a pure *data* migration (no DDL):
/// for each deck whose `scheduler_kind` is not `'fsrs6'`, every card's
/// `(stability, difficulty)` pair — whose meaning was algorithm-specific
/// (SM-2 stored the easiness factor, Leitner the box index, HLR the
/// correct/incorrect counts, MEMORIZE the forgetting rate) — is converted to
/// genuine FSRS memory fields through
/// [`crate::scheduler::convert_memory_fields`] (P073), anchored on the card's
/// `scheduled_days` (its last interval). The deck row is then stamped
/// `'fsrs6'`.
///
/// The `decks.scheduler_kind` column and its v15/v17 CHECK constraint are
/// left untouched (no table rebuild): the legacy values stay *storable* so
/// this migration — and any pre-v19 backup replayed through it — keeps
/// parsing, but after v19 the application only ever writes `'fsrs6'`.
///
/// Unlike the SQL-only migrations this one needs per-row Rust logic, so it
/// runs through [`apply_migration_with`] — same transaction + FK-guard
/// envelope, arbitrary body.
fn migrate_v19_fsrs6_only(conn: &Connection) -> AppResult<()> {
    use std::str::FromStr;

    use crate::scheduler::{convert_memory_fields, SchedulerKind};

    // Decks still on a legacy algorithm, collected up front so no SELECT
    // statement is alive while the per-card UPDATEs run below.
    let legacy_decks: Vec<(i64, String)> = {
        let mut stmt =
            conn.prepare("SELECT id, scheduler_kind FROM decks WHERE scheduler_kind <> 'fsrs6'")?;
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };

    for (deck_id, kind_str) in legacy_decks {
        // The CHECK constraint pins the stored values to the known set, so a
        // parse failure here means a corrupted DB — abort (and roll back).
        let old_kind = SchedulerKind::from_str(&kind_str)?;

        let cards: Vec<(i64, Option<f64>, Option<f64>, i64)> = {
            let mut stmt = conn.prepare(
                "SELECT id, stability, difficulty, scheduled_days
                 FROM cards WHERE deck_id = ?1",
            )?;
            let rows = stmt.query_map(rusqlite::params![deck_id], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
            })?;
            rows.collect::<rusqlite::Result<Vec<_>>>()?
        };

        for (card_id, stability, difficulty, scheduled_days) in cards {
            let (new_stability, new_difficulty) = convert_memory_fields(
                old_kind,
                SchedulerKind::Fsrs6,
                stability,
                difficulty,
                scheduled_days,
            );
            conn.execute(
                "UPDATE cards SET stability = ?1, difficulty = ?2 WHERE id = ?3",
                rusqlite::params![new_stability, new_difficulty, card_id],
            )?;
        }

        conn.execute(
            "UPDATE decks SET scheduler_kind = 'fsrs6' WHERE id = ?1",
            rusqlite::params![deck_id],
        )?;
    }

    Ok(())
}

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

    // v17 — FK integrity hardening: ON DELETE SET NULL on
    // `decks.prerequisite_deck_id`, ON DELETE CASCADE on `cards.deck_id`,
    // and a `notes(deck_id)` index.
    if current < 17 {
        apply_migration(conn, 17, SCHEMA_V17)?;
    }

    // v18 — P018: per-deck due covering index.
    if current < 18 {
        apply_migration(conn, 18, SCHEMA_V18)?;
    }

    // v19 — restructure/v0.11: FSRS-6 is the only scheduler. Convert every
    // legacy deck's cards to FSRS memory fields and stamp the decks 'fsrs6'.
    if current < 19 {
        apply_migration_with(conn, 19, migrate_v19_fsrs6_only)?;
    }

    Ok(())
}

/// Run `sql` inside a transaction and bump `user_version` to `version`.
/// Thin wrapper over [`apply_migration_with`] for the SQL-only migrations.
fn apply_migration(conn: &Connection, version: i32, sql: &str) -> AppResult<()> {
    apply_migration_with(conn, version, |conn| {
        conn.execute_batch(sql)?;
        Ok(())
    })
}

/// Run a migration `body` inside a transaction and bump `user_version` to
/// `version`. Most migrations are plain SQL batches (see
/// [`apply_migration`]); data migrations whose per-row logic SQL alone can't
/// express (v19's scheduler-field conversion goes through Rust code in
/// [`crate::scheduler`]) pass an arbitrary body and get the exact same
/// envelope.
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
/// Table Schema Changes").
///
/// Panic-safety: the restore of `foreign_keys = ON` runs from an [`FkGuard`]
/// `Drop` impl, so the live connection is *never* left with FK enforcement
/// disabled — not on an early `?` return, not on a `COMMIT` failure, and not
/// if `execute_batch` panics (e.g. an OOM unwind). Leaving FKs off would mean
/// silent loss of cascade/constraint integrity for the rest of the session,
/// since this `Connection` is the long-lived one shared by every command.
///
/// Integrity: every table-rebuild migration runs with FKs disabled, so a buggy
/// `INSERT … SELECT` could leave dangling references. We run
/// `PRAGMA foreign_key_check` *inside* the transaction, just before `COMMIT`,
/// and abort (ROLLBACK) if it reports any violation — so a migration can never
/// commit an orphaned row.
fn apply_migration_with(
    conn: &Connection,
    version: i32,
    body: impl FnOnce(&Connection) -> AppResult<()>,
) -> AppResult<()> {
    log::info!("Applying DB migration v{}", version);

    // Disabling FKs must happen OUTSIDE any transaction (SQLite ignores the
    // pragma inside one). The guard re-asserts `foreign_keys = ON` from its
    // `Drop`, covering every exit path including a panic.
    conn.pragma_update(None, "foreign_keys", "OFF")?;
    let _fk_guard = FkGuard { conn };

    conn.execute_batch("BEGIN;")?;
    if let Err(e) = body(conn) {
        // Best-effort rollback; surface the original error regardless.
        let _ = conn.execute_batch("ROLLBACK;");
        return Err(AppError::Database(format!(
            "migration v{} failed: {}",
            version, e
        )));
    }

    // A table rebuild ran with FKs disabled — verify it left no dangling
    // reference before committing. `foreign_key_check` returns one row per
    // violation; any row means the migration is unsound, so we abort.
    if let Err(e) = assert_no_fk_violations(conn) {
        let _ = conn.execute_batch("ROLLBACK;");
        return Err(AppError::Database(format!(
            "migration v{} aborted — foreign-key check failed: {}",
            version, e
        )));
    }

    // `PRAGMA user_version = ?` does not accept bind params, so format
    // literally. `version` is a hard-coded i32 — no injection risk.
    if let Err(e) = conn.execute_batch(&format!("PRAGMA user_version = {};", version)) {
        let _ = conn.execute_batch("ROLLBACK;");
        return Err(e.into());
    }
    conn.execute_batch("COMMIT;")?;
    Ok(())
    // `_fk_guard` drops here, restoring `foreign_keys = ON`.
}

/// Run `PRAGMA foreign_key_check` and fail if it reports any violation.
///
/// Must be called inside the migration transaction (after the rebuild SQL,
/// before COMMIT) so a detected orphan can be rolled back. Each violation row
/// is `(table, rowid, referenced_table, fk_index)`; we only need to know that
/// at least one exists, plus a short description for the error message.
fn assert_no_fk_violations(conn: &Connection) -> AppResult<()> {
    let mut stmt = conn.prepare("PRAGMA foreign_key_check;")?;
    let mut rows = stmt.query([])?;
    if let Some(row) = rows.next()? {
        let table: String = row.get(0).unwrap_or_else(|_| "<unknown>".to_string());
        let parent: String = row.get(2).unwrap_or_else(|_| "<unknown>".to_string());
        return Err(AppError::Database(format!(
            "foreign-key violation in `{}` referencing `{}`",
            table, parent
        )));
    }
    Ok(())
}

/// RAII guard that re-asserts `PRAGMA foreign_keys = ON` when dropped.
///
/// Used by [`apply_migration`] so FK enforcement is restored on *every* exit
/// path — early return, error, or panic unwind — preventing the shared live
/// connection from silently running the rest of the session with foreign keys
/// disabled.
struct FkGuard<'a> {
    conn: &'a Connection,
}

impl Drop for FkGuard<'_> {
    fn drop(&mut self) {
        if let Err(e) = self.conn.pragma_update(None, "foreign_keys", "ON") {
            // Can't propagate from Drop; log loudly. A failure here is
            // exceptional (the connection would have to be unusable).
            log::error!("failed to restore foreign_keys=ON after migration: {}", e);
        }
    }
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
        assert!(
            bad.is_err(),
            "unknown scheduler_kind must violate the CHECK"
        );
    }

    /// Helper: the `ON DELETE` action SQLite records for the FK on
    /// `table.column` pointing at `parent`. Returns e.g. `"SET NULL"` /
    /// `"CASCADE"` / `"NO ACTION"`.
    fn fk_on_delete(conn: &Connection, table: &str, column: &str, parent: &str) -> Option<String> {
        let mut stmt = conn
            .prepare(&format!("PRAGMA foreign_key_list({table})"))
            .expect("prepare foreign_key_list");
        // foreign_key_list columns: id, seq, table, from, to, on_update,
        // on_delete, match.
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(2)?, // parent table
                    r.get::<_, String>(3)?, // from column
                    r.get::<_, String>(6)?, // on_delete
                ))
            })
            .expect("query foreign_key_list");
        for row in rows {
            let (p, from, on_delete) = row.expect("fk row");
            if p == parent && from == column {
                return Some(on_delete);
            }
        }
        None
    }

    /// v17 — `decks.prerequisite_deck_id` must carry `ON DELETE SET NULL`,
    /// `cards.deck_id` must carry `ON DELETE CASCADE`, and `idx_notes_deck`
    /// must exist. Guards the FK-integrity hardening (P013 / P014).
    #[test]
    fn migration_v17_sets_fk_actions_and_notes_index() {
        let db = crate::db::Database::for_test();
        let conn = db.lock();

        assert_eq!(
            fk_on_delete(&conn, "decks", "prerequisite_deck_id", "decks").as_deref(),
            Some("SET NULL"),
            "decks.prerequisite_deck_id must be ON DELETE SET NULL"
        );
        assert_eq!(
            fk_on_delete(&conn, "cards", "deck_id", "decks").as_deref(),
            Some("CASCADE"),
            "cards.deck_id must be ON DELETE CASCADE"
        );

        // The deck→note lookup index must exist.
        let has_index: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master
                 WHERE type = 'index' AND name = 'idx_notes_deck'",
                [],
                |r| r.get(0),
            )
            .expect("query sqlite_master for idx_notes_deck");
        assert_eq!(has_index, 1, "idx_notes_deck index must be created by v17");

        // The cards indexes recreated during the rebuild must survive.
        for idx in ["idx_cards_due", "idx_cards_deck", "idx_cards_state"] {
            let present: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = ?1",
                    rusqlite::params![idx],
                    |r| r.get(0),
                )
                .expect("query sqlite_master for cards index");
            assert_eq!(present, 1, "{idx} must survive the v17 cards rebuild");
        }
    }

    /// v19 — legacy-scheduler decks must be converted to FSRS-6: every card's
    /// `(stability, difficulty)` is re-encoded as genuine FSRS memory fields
    /// (anchored on `scheduled_days`) and the deck is stamped `'fsrs6'`. Boots
    /// a DB at v18 — one step short of CURRENT — seeds one deck per legacy
    /// algorithm plus an FSRS-6 control, then replays `run` and checks the
    /// converted stabilities are the plausible day-scale values.
    #[test]
    fn migration_v19_converts_legacy_decks_to_fsrs6() {
        let conn = rusqlite::Connection::open_in_memory().expect("open in-memory");
        for (version, sql) in [
            (1, SCHEMA_V1),
            (2, SCHEMA_V2),
            (3, SCHEMA_V3),
            (4, SCHEMA_V4),
            (5, SCHEMA_V5),
            (6, SCHEMA_V6),
            (7, SCHEMA_V7),
            (8, SCHEMA_V8),
            (9, SCHEMA_V9),
            (10, SCHEMA_V10),
            (11, SCHEMA_V11),
            (12, SCHEMA_V12),
            (13, SCHEMA_V13),
            (14, SCHEMA_V14),
            (15, SCHEMA_V15),
            (16, SCHEMA_V16),
            (17, SCHEMA_V17),
            (18, SCHEMA_V18),
        ] {
            apply_migration(&conn, version, sql)
                .unwrap_or_else(|e| panic!("bootstrap migration v{version}: {e}"));
        }

        // Seed one deck + note + reviewed card under `kind`, returning
        // `(deck_id, card_id)`. Field semantics are the pre-v19 per-algorithm
        // encodings (EF / box index / counters / forgetting rate).
        let seed = |name: &str,
                    kind: &str,
                    stability: Option<f64>,
                    difficulty: Option<f64>,
                    scheduled_days: i64|
         -> (i64, i64) {
            conn.execute(
                "INSERT INTO decks (name, color, desired_retention, scheduler_kind,
                                    created_at, updated_at)
                 VALUES (?1, '#3b82f6', 0.9, ?2, 0, 0)",
                rusqlite::params![name, kind],
            )
            .expect("seed deck");
            let deck_id = conn.last_insert_rowid();
            conn.execute(
                "INSERT INTO notes (deck_id, template, fields, tags, created_at, updated_at)
                 VALUES (?1, 'basic', '{\"front\":\"q\",\"back\":\"a\"}', '[]', 0, 0)",
                rusqlite::params![deck_id],
            )
            .expect("seed note");
            let note_id = conn.last_insert_rowid();
            conn.execute(
                "INSERT INTO cards (note_id, deck_id, card_ord, state, stability, difficulty,
                                    scheduled_days, created_at, updated_at)
                 VALUES (?1, ?2, 0, 'review', ?3, ?4, ?5, 0, 0)",
                rusqlite::params![note_id, deck_id, stability, difficulty, scheduled_days],
            )
            .expect("seed card");
            (deck_id, conn.last_insert_rowid())
        };

        // SM-2: EF 2.5 in `difficulty`, last interval 20 d.
        let (sm2_deck, sm2_card) = seed("sm2-deck", "sm2", Some(0.0), Some(2.5), 20);
        // Leitner: box 4 in `difficulty` (30-day box).
        let (_, leitner_card) = seed("leitner-deck", "leitner", Some(0.0), Some(4.0), 30);
        // HLR: 5 correct / 0 incorrect in `(stability, difficulty)`.
        let (_, hlr_card) = seed("hlr-deck", "hlr", Some(5.0), Some(0.0), 10);
        // MEMORIZE: forgetting rate 0.09 in `difficulty` (interval 2.7/√n = 9 d).
        let (_, memorize_card) = seed("memorize-deck", "memorize", Some(0.0), Some(0.09), 9);
        // FSRS-6 control deck — must come through completely untouched.
        let (_, fsrs_card) = seed("fsrs-deck", "fsrs6", Some(12.5), Some(6.0), 12);

        // A pristine New card in the SM-2 deck (never reviewed, NULL fields) —
        // must stay fresh rather than gaining bogus memory state.
        conn.execute(
            "INSERT INTO notes (deck_id, template, fields, tags, created_at, updated_at)
             VALUES (?1, 'basic', '{\"front\":\"q2\",\"back\":\"a2\"}', '[]', 0, 0)",
            rusqlite::params![sm2_deck],
        )
        .unwrap();
        let pristine_note = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO cards (note_id, deck_id, card_ord, state, created_at, updated_at)
             VALUES (?1, ?2, 0, 'new', 0, 0)",
            rusqlite::params![pristine_note, sm2_deck],
        )
        .unwrap();
        let pristine_card = conn.last_insert_rowid();

        run(&conn).expect("replay v19");

        let user_version: i32 = conn
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .expect("read user_version");
        assert_eq!(user_version, CURRENT_VERSION);

        // Every deck must now be FSRS-6.
        let legacy_left: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM decks WHERE scheduler_kind <> 'fsrs6'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(legacy_left, 0, "every deck must be stamped 'fsrs6'");

        let fields = |card_id: i64| -> (Option<f64>, Option<f64>) {
            conn.query_row(
                "SELECT stability, difficulty FROM cards WHERE id = ?1",
                rusqlite::params![card_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .expect("read card fields")
        };

        // SM-2: EF carries no day scale — the last interval (20 d) anchors the
        // stability; difficulty seeds the FSRS neutral midpoint.
        let (s, d) = fields(sm2_card);
        assert!((s.unwrap() - 20.0).abs() < 1e-9, "sm2 stability: {s:?}");
        assert!((d.unwrap() - 5.0).abs() < 1e-9, "sm2 difficulty: {d:?}");

        // Leitner: box 4 ↔ its 30-day interval.
        let (s, d) = fields(leitner_card);
        assert!((s.unwrap() - 30.0).abs() < 1e-9, "leitner stability: {s:?}");
        assert!((d.unwrap() - 5.0).abs() < 1e-9, "leitner difficulty: {d:?}");

        // HLR: half-life 2^(5-0+1) = 64 d, rescaled from the 50 %-recall point
        // to the 90 %-recall scale: 64·log2(1/0.9) ≈ 9.73 d — NOT the raw 64.
        let (s, d) = fields(hlr_card);
        let expected_hlr = 64.0 * (1.0f64 / 0.9).log2();
        assert!(
            (s.unwrap() - expected_hlr).abs() < 1e-6,
            "hlr stability: expected ≈{expected_hlr}, got {s:?}"
        );
        assert!((d.unwrap() - 5.0).abs() < 1e-9, "hlr difficulty: {d:?}");

        // MEMORIZE: rate 0.09 → interval 2.7/√0.09 = 9 d.
        let (s, _) = fields(memorize_card);
        assert!((s.unwrap() - 9.0).abs() < 1e-9, "memorize stability: {s:?}");

        // FSRS-6 control deck — untouched (same-algorithm no-op).
        let (s, d) = fields(fsrs_card);
        assert_eq!(s, Some(12.5), "fsrs6 card must keep its stability");
        assert_eq!(d, Some(6.0), "fsrs6 card must keep its difficulty");

        // Pristine New card — stays fresh under FSRS-6 too.
        let (s, d) = fields(pristine_card);
        assert!(
            s.is_none() && d.is_none(),
            "a never-reviewed card must not gain memory state ({s:?}, {d:?})"
        );
    }
}
