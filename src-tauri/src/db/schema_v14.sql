-- v14__word_status.sql
-- Reading Import (Vague 17 — LingQ-style known/learning/new word tracking).
--
-- One row per (word, language) the learner has classified while reading an
-- imported text. The status drives the in-text highlight colour and the
-- "create cards from unknown words" flow:
--   - 'new'      : never marked (the UI also treats absent rows as 'new')
--   - 'learning' : actively acquiring — eligible to become a Basic card
--   - 'known'    : mastered — rendered without highlight
--
-- The primary key is the composite (word, language) so the same spelling can
-- carry an independent status per language deck (e.g. "chat" in fr vs en).
-- `word` is always stored lower-cased + trimmed by the repo so lookups are
-- case-insensitive without a COLLATE clause. NULL status is impossible — a
-- row only exists once the learner has explicitly classified the word.

CREATE TABLE IF NOT EXISTS word_status (
    word TEXT NOT NULL,                 -- lower-cased, trimmed by the repo
    language TEXT NOT NULL,             -- ISO 639-1 hint ('en', 'ja', …) or ''
    status TEXT NOT NULL CHECK(status IN ('new', 'learning', 'known')),
    updated_at INTEGER NOT NULL,        -- unix seconds, UTC
    PRIMARY KEY (word, language)
);

CREATE INDEX IF NOT EXISTS idx_word_status_lang ON word_status(language);
