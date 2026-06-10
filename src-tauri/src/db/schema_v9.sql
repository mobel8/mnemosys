-- v9__metacognition.sql
-- Delayed Judgments of Learning (JOL) — Vague 7 « tier S » metacognition.
--
-- ⚠ v0.11 — LEGACY, table kept inert. The delayed-JOL pipeline was removed:
-- it could never bootstrap (the prompt that recorded predictions only opened
-- when predictions already existed, so `jol_predictions` never received its
-- first row). The calibration dashboard is now computed from the CBM
-- confidence on `reviews.confidence` (see `db/metacognition.rs`). The table
-- and its indexes stay as-is — migrations are append-only and a DROP would
-- buy nothing — but no code writes to or reads from them anymore.
--
-- Original design (historical): Rhodes & Tauber 2011 meta-analysis (4554
-- subjects) found delayed JOLs correlate strongly with subsequent test
-- performance: Goodman-Kruskal γ jumps from ~0.4 (immediate JOL) to ~0.9
-- (delayed). The signature loop: the learner predicts a recall probability
-- at study time, the system prompts them again ~30 min later (« delayed »),
-- and the prediction is resolved against the next actual review outcome to
-- surface a calibration dashboard (over/under-confidence + per-bucket bias).

CREATE TABLE IF NOT EXISTS jol_predictions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id INTEGER NOT NULL,
    predicted_at INTEGER NOT NULL,                           -- unix seconds when JOL given
    predicted_prob REAL NOT NULL,                            -- [0.0, 1.0]
    prediction_horizon_days INTEGER NOT NULL DEFAULT 7,      -- « predict for X days from now »
    actual_correct INTEGER,                                  -- 1=correct, 0=incorrect, NULL=pending
    resolved_at INTEGER,                                     -- unix seconds when next review happened
    FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_jol_card ON jol_predictions(card_id);
CREATE INDEX IF NOT EXISTS idx_jol_unresolved ON jol_predictions(actual_correct)
    WHERE actual_correct IS NULL;
CREATE INDEX IF NOT EXISTS idx_jol_predicted_at ON jol_predictions(predicted_at);
