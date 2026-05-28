-- v12 — Vague 14 Modes disciplinaires.
--
-- Extend the `notes.template` CHECK constraint to accept two new
-- discipline-specific templates:
--   - `'illness_script'` (médecine, Charlin 2007) — one card, condition →
--     four clinical sections (epidemiology / pathophysiology / clinical /
--     management).
--   - `'refutation'`     (sciences, Tippett 2010 meta) — one card confronting
--     a misconception with the correct statement + explanation.
--
-- SQLite has no `ALTER TABLE … DROP/ADD CONSTRAINT`, so we follow the same
-- 12-step recipe as v2 / v11: drop the FTS5 helpers, rebuild `notes` with the
-- relaxed CHECK, copy every row verbatim, recreate the FTS5 virtual table +
-- sync triggers, then rebuild the index. No data is dropped.
--
-- The rebuilt `notes_new` schema is byte-for-byte the v11 layout (id, deck_id,
-- template, fields, tags, created_at, updated_at, remote_id, frequency_band)
-- with only the two extra `template` values added — so the `remote_id` unique
-- index and the `frequency_band` partial index are recreated identically.

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
        'illness_script', 'refutation'
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
