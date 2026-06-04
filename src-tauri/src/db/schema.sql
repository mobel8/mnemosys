-- v1__initial.sql

CREATE TABLE decks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    color TEXT NOT NULL DEFAULT '#3b82f6',
    -- P089: bound retention at the DB level so EVERY write path (local
    -- create/update AND sync/apply from a remote payload) is defended, not
    -- just the Rust validation in DeckRepo. NaN fails `BETWEEN`, so it is
    -- rejected too.
    desired_retention REAL NOT NULL DEFAULT 0.9 CHECK(desired_retention BETWEEN 0.5 AND 0.99),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    deck_id INTEGER NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
    template TEXT NOT NULL CHECK(template IN ('basic', 'basic_reverse', 'cloze', 'occlusion')),
    fields TEXT NOT NULL,
    tags TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    deck_id INTEGER NOT NULL REFERENCES decks(id),
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
    updated_at INTEGER NOT NULL
);

CREATE INDEX idx_cards_due ON cards(next_review) WHERE suspended = 0;
CREATE INDEX idx_cards_deck ON cards(deck_id);
CREATE INDEX idx_cards_state ON cards(state) WHERE suspended = 0;
-- P018: composite covering index for the per-deck due query (deck filter +
-- next_review range), avoiding a cross-deck scan + temp B-tree each session.
CREATE INDEX idx_cards_due_deck ON cards(deck_id, next_review) WHERE suspended = 0;

CREATE TABLE reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 4),
    state_before TEXT NOT NULL,
    state_after TEXT NOT NULL,
    stability_before REAL,
    stability_after REAL NOT NULL,
    difficulty_before REAL,
    difficulty_after REAL NOT NULL,
    elapsed_days INTEGER NOT NULL,
    scheduled_days INTEGER NOT NULL,
    review_time INTEGER NOT NULL,
    reviewed_at INTEGER NOT NULL
);

CREATE INDEX idx_reviews_card ON reviews(card_id);
CREATE INDEX idx_reviews_date ON reviews(reviewed_at);

CREATE VIRTUAL TABLE notes_fts USING fts5(
    fields,
    tags,
    content=notes,
    content_rowid=id,
    tokenize='trigram'
);

-- FTS5 sync triggers
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

CREATE TABLE fsrs_params (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    params_json TEXT NOT NULL,
    optimized_at INTEGER,
    reviews_at_optim INTEGER NOT NULL DEFAULT 0
);
