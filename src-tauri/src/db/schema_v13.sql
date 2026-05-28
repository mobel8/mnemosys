-- v13 — Vague 15: Maths worked-example template + mastery gating + two-step
-- retrospective confidence.
--
-- Three coupled changes land in this single migration:
--
--   1. Extend the `notes.template` CHECK constraint to accept
--      `'worked_example'` (maths, Sweller/Renkl/Atkinson 2003 — one card,
--      a problem whose solution steps fade in progressively before the
--      final answer). SQLite has no `ALTER TABLE … DROP/ADD CONSTRAINT`, so
--      we follow the same 12-step recipe as v2 / v11 / v12: drop the FTS5
--      helpers, rebuild `notes` with the relaxed CHECK, copy every row
--      verbatim, recreate the FTS5 virtual table + sync triggers, then
--      rebuild the index. No data is dropped — `remote_id` and
--      `frequency_band` are copied across with their indices recreated
--      identically.
--
--   2. Add a nullable `prerequisite_deck_id INTEGER REFERENCES decks(id)`
--      column to `decks` (Bloom mastery learning). A deck stays "locked"
--      until its prerequisite is mastered (≥90 % retention over the last
--      30 days, ≥20 reviews). Plain `ALTER TABLE … ADD COLUMN` — no CHECK
--      needed, the FK is enough.
--
--   3. Add a nullable `confidence_post INTEGER` column to `reviews`
--      (Bang & Fleming 2018 — two-step retrospective confidence captured
--      AFTER the answer is revealed, complementing the prospective
--      `confidence` column from v5). Plain `ALTER TABLE … ADD COLUMN`.

-- ---- (1) notes CHECK rebuild -----------------------------------------------

DROP TRIGGER IF EXISTS notes_ai;
DROP TRIGGER IF EXISTS notes_ad;
DROP TRIGGER IF EXISTS notes_au;

DROP TABLE IF EXISTS notes_fts;

CREATE TABLE notes_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    deck_id INTEGER NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
    template TEXT NOT NULL CHECK(template IN (
        'basic', 'basic_reverse', 'cloze', 'occlusion',
        'sentence', 'bidirectional',
        'illness_script', 'refutation',
        'worked_example'
    )),
    fields TEXT NOT NULL,
    tags TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    remote_id TEXT,
    frequency_band TEXT
        CHECK (frequency_band IS NULL OR frequency_band IN (
            'top_100', 'top_1k', 'top_5k', 'top_10k', 'beyond'
        ))
);

INSERT INTO notes_new (id, deck_id, template, fields, tags, created_at, updated_at, remote_id, frequency_band)
SELECT id, deck_id, template, fields, tags, created_at, updated_at, remote_id, frequency_band FROM notes;

DROP TABLE notes;
ALTER TABLE notes_new RENAME TO notes;

-- Recreate the unique index on remote_id (v3) — it died with the old table.
CREATE UNIQUE INDEX IF NOT EXISTS idx_notes_remote_id
    ON notes(remote_id) WHERE remote_id IS NOT NULL;

-- Partial index for filtering by frequency_band (v11) — only non-null rows.
CREATE INDEX IF NOT EXISTS idx_notes_freq
    ON notes(frequency_band) WHERE frequency_band IS NOT NULL;

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

-- ---- (2) mastery gating: prerequisite_deck_id on decks ---------------------

ALTER TABLE decks ADD COLUMN prerequisite_deck_id INTEGER REFERENCES decks(id);

-- ---- (3) two-step retrospective confidence: confidence_post on reviews ------

ALTER TABLE reviews ADD COLUMN confidence_post INTEGER;
