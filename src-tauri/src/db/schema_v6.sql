-- v6__wellness.sql
-- Optional wellness tracking (Vague 3 — Neuro modes, opt-in, local-only).
--
-- Each row is a snapshot captured by the pre-session Mood/Sleep check-in.
-- Every nullable column means « learner chose to skip that question » —
-- the back-end never imputes a default. Booleans default to false so a
-- partial submission can still be persisted in one round trip.
--
-- The `date` column is the human-facing ISO calendar date (`YYYY-MM-DD`)
-- so the UI can look up "today's" log without TZ math; the `created_at`
-- unix-seconds timestamp preserves wall-clock ordering if a learner ends
-- up logging twice on the same calendar day.

CREATE TABLE IF NOT EXISTS wellness_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,                 -- ISO 'YYYY-MM-DD'
    mood INTEGER,                       -- 1..5, NULL if skipped
    sleep_hours REAL,                   -- 0..12, NULL if skipped
    stress_level INTEGER,               -- 1..5, NULL if skipped
    hydrated BOOLEAN NOT NULL DEFAULT 0,
    caffeine_taken BOOLEAN NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL         -- unix seconds, UTC
);

CREATE INDEX IF NOT EXISTS idx_wellness_date ON wellness_logs(date);
