-- v8__sketches.sql
-- Optional drawing-effect sketches captured before flipping a card.
--
-- Wammes et al. 2016 / 2018 demonstrate a 30-50% recall boost when learners
-- sketch their guess BEFORE seeing the answer (« drawing effect »). One row
-- per submitted review: we tie it to the `reviews` row by `review_id`, which
-- gives us idempotency (drawing for the same review overwrites nothing — the
-- caller is expected to insert exactly once) and a clean cascade on review
-- deletion.
--
-- `sketch_data` is a PNG `data:` URL string. Acceptable for an MVP — a
-- 800×400 PNG of pencil strokes typically lands under 50 KB. A future
-- migration could move large blobs to disk if the SQLite file balloons.

CREATE TABLE IF NOT EXISTS review_sketches (
    review_id INTEGER PRIMARY KEY,
    card_id INTEGER NOT NULL,
    sketch_data TEXT NOT NULL,          -- PNG base64 (data URL)
    created_at INTEGER NOT NULL,        -- unix seconds, UTC
    FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE,
    FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sketches_card ON review_sketches(card_id);
CREATE INDEX IF NOT EXISTS idx_sketches_created_at ON review_sketches(created_at);
