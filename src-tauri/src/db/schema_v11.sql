-- v11 — Vague 10 Mode Langue.
--
-- 1. Extend the `notes.template` CHECK constraint to accept the two new
--    language-learning templates: `'sentence'` (one card) and
--    `'bidirectional'` (two cards, source→target + target→source).
--    Same 12-step recipe as v2: drop FTS5, rebuild `notes`, recreate FTS5
--    + triggers, rebuild the index. We do NOT drop notes data — every
--    pre-v11 row is copied over verbatim.
--
-- 2. Add a nullable `frequency_band TEXT` column on `notes` for
--    language-learning frequency tagging (top_100 / top_1k / top_5k /
--    top_10k / beyond). The CHECK constraint accepts NULL so every
--    existing note stays valid without retro-tagging.
--
-- The two changes share the rebuild: we declare `frequency_band` inline
-- in the new `notes_new` schema, then copy the existing column-set across
-- with a NULL for the freshly-minted column.
--
-- 3. Add a nullable `language_mode TEXT` column on `decks` (ISO 639-1 code
--    or NULL). No CHECK constraint — any short code is acceptable and the
--    UI restricts the picker to a known set. A plain ALTER TABLE suffices
--    (no constraint to retro-fit), so `decks` is NOT rebuilt here.

ALTER TABLE decks ADD COLUMN language_mode TEXT;

DROP TRIGGER IF EXISTS notes_ai;
DROP TRIGGER IF EXISTS notes_ad;
DROP TRIGGER IF EXISTS notes_au;

DROP TABLE IF EXISTS notes_fts;

CREATE TABLE notes_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    deck_id INTEGER NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
    template TEXT NOT NULL CHECK(template IN (
        'basic', 'basic_reverse', 'cloze', 'occlusion',
        'sentence', 'bidirectional'
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
SELECT id, deck_id, template, fields, tags, created_at, updated_at, remote_id, NULL FROM notes;

DROP TABLE notes;
ALTER TABLE notes_new RENAME TO notes;

-- Recreate the unique index on remote_id (v3) — it died with the old table.
CREATE UNIQUE INDEX IF NOT EXISTS idx_notes_remote_id
    ON notes(remote_id) WHERE remote_id IS NOT NULL;

-- Partial index for filtering by frequency_band (only non-null rows are interesting).
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
