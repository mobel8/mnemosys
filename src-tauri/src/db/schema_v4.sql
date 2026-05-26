-- v4__gamification.sql
-- Ethical (White Hat) gamification primitives: streaks, freezes, achievements.

-- Singleton row tracking user-level gamification stats.
CREATE TABLE IF NOT EXISTS user_stats (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    streak_current INTEGER NOT NULL DEFAULT 0,
    streak_best INTEGER NOT NULL DEFAULT 0,
    last_review_date TEXT,                       -- ISO 'YYYY-MM-DD'
    freeze_remaining INTEGER NOT NULL DEFAULT 2, -- freezes available this month
    freeze_month TEXT,                           -- ISO 'YYYY-MM' for monthly reset
    total_reviews INTEGER NOT NULL DEFAULT 0,
    total_correct INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO user_stats (id) VALUES (1);

CREATE TABLE IF NOT EXISTS achievements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,        -- e.g. 'first_review', 'streak_7', 'master_100'
    unlocked_at INTEGER NOT NULL      -- unix ts (seconds)
);
