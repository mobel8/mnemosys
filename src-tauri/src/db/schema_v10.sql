-- v10 — Memory Palace 3D Builder (Vague 9).
--
-- Method-of-loci ("memory palaces") let learners attach a card to a 3D
-- location inside an imagined building. The traversal order (`ordinal`) is
-- the route the learner walks through during review — Krokos et al. 2019
-- (Virtual Reality 23) reports +8.8 % recall vs a flat list, mirroring the
-- place/grid-cell circuitry behind episodic memory (Nobel 2014, O'Keefe &
-- Moser).
--
-- One palace groups many loci. A locus pins exactly one card to a (x, y, z)
-- spot. The composite UNIQUE(palace_id, card_id) guarantees a card cannot
-- be placed twice inside the same palace (it can still appear in *other*
-- palaces — useful for review variety across rooms). `ordinal` is the
-- traversal index used by the walk-through review mode.

CREATE TABLE IF NOT EXISTS palaces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    template TEXT NOT NULL DEFAULT 'house'
        CHECK(template IN ('house', 'street', 'castle', 'custom')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS palace_loci (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    palace_id INTEGER NOT NULL REFERENCES palaces(id) ON DELETE CASCADE,
    card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    x REAL NOT NULL,
    y REAL NOT NULL,
    z REAL NOT NULL,
    ordinal INTEGER NOT NULL,
    label TEXT,
    created_at INTEGER NOT NULL,
    UNIQUE(palace_id, card_id)
);

CREATE INDEX IF NOT EXISTS idx_loci_palace ON palace_loci(palace_id);
CREATE INDEX IF NOT EXISTS idx_loci_ordinal ON palace_loci(palace_id, ordinal);
