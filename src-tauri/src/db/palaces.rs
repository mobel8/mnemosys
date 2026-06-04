//! Memory Palace repository — method-of-loci spatial review (Vague 9).
//!
//! A "palace" is a 3D scene the learner mentally walks through; each
//! "locus" pins exactly one flashcard to a (x, y, z) anchor inside that
//! scene. The traversal `ordinal` is the order the learner visits them
//! during a review walk-through.
//!
//! Schema (`schema_v10.sql`):
//!   - `palaces(id, name, description, template, created_at, updated_at)`
//!     `template ∈ { 'house', 'street', 'castle', 'custom' }`
//!   - `palace_loci(id, palace_id, card_id, x, y, z, ordinal, label, created_at)`
//!     with `UNIQUE(palace_id, card_id)` (a card can only sit on one
//!     locus per palace) and `ON DELETE CASCADE` for both parent FKs.
//!
//! Evidence
//! --------
//! - Krokos, Plaisant & Varshney 2019, Virtual Reality 23 — +8.8 % recall
//!   in a VR memory-palace vs flat-list control.
//! - Nobel Prize 2014, O'Keefe / Moser — place / grid cells in the
//!   hippocampal-entorhinal network are the neural substrate of episodic
//!   memory, the same circuitry mnemonists exploit.

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

/// One palace row, fully materialised.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Palace {
    pub id: i64,
    pub name: String,
    pub description: Option<String>,
    /// One of `house` / `street` / `castle` / `custom`. The 3D builder
    /// instantiates the matching scene template; `custom` lets a future
    /// release plug in user-loaded GLTF assets.
    pub template: String,
    pub created_at: i64,
    pub updated_at: i64,
}

/// One locus row (a card pinned at (x, y, z) inside a palace).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PalaceLocus {
    pub id: i64,
    pub palace_id: i64,
    pub card_id: i64,
    pub x: f64,
    pub y: f64,
    pub z: f64,
    /// 0-based traversal order — the review walk-through visits loci in
    /// ascending `ordinal`. Reassigned by `reorder_loci`.
    pub ordinal: i64,
    /// Optional human label ("kitchen sink", "front door") shown in the UI.
    pub label: Option<String>,
    pub created_at: i64,
}

/// Composite payload returned by `get`: the palace row + its loci in
/// traversal order. Keeps the frontend free from a follow-up round-trip.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PalaceWithLoci {
    #[serde(flatten)]
    pub palace: Palace,
    pub loci: Vec<PalaceLocus>,
}

/// Thin repository — borrows the active connection.
pub struct PalaceRepo<'a> {
    conn: &'a Connection,
}

impl<'a> PalaceRepo<'a> {
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }

    /// All palaces, alphabetical by name. Used by the index route.
    pub fn list(&self) -> AppResult<Vec<Palace>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, description, template, created_at, updated_at
             FROM palaces
             ORDER BY name COLLATE NOCASE ASC",
        )?;
        let rows = stmt.query_map([], row_to_palace)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    /// Palace + its loci, ordered by ascending `ordinal`.
    pub fn get(&self, id: i64) -> AppResult<PalaceWithLoci> {
        let palace = self
            .conn
            .query_row(
                "SELECT id, name, description, template, created_at, updated_at
                 FROM palaces WHERE id = ?1",
                params![id],
                row_to_palace,
            )
            .optional()?
            .ok_or_else(|| AppError::NotFound(format!("palace id={}", id)))?;

        let mut stmt = self.conn.prepare(
            "SELECT id, palace_id, card_id, x, y, z, ordinal, label, created_at
             FROM palace_loci
             WHERE palace_id = ?1
             ORDER BY ordinal ASC",
        )?;
        let rows = stmt.query_map(params![id], row_to_locus)?;
        let mut loci = Vec::new();
        for r in rows {
            loci.push(r?);
        }

        Ok(PalaceWithLoci { palace, loci })
    }

    /// Insert a new palace. `name` must be unique (DB-enforced).
    pub fn create(
        &self,
        name: &str,
        description: Option<&str>,
        template: &str,
        now: i64,
    ) -> AppResult<Palace> {
        if name.trim().is_empty() {
            return Err(AppError::Validation("palace name must not be empty".into()));
        }
        if !matches!(template, "house" | "street" | "castle" | "custom") {
            return Err(AppError::Validation(format!(
                "template must be one of house/street/castle/custom (got {})",
                template
            )));
        }
        self.conn.execute(
            "INSERT INTO palaces (name, description, template, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?4)",
            params![name, description, template, now],
        )?;
        let id = self.conn.last_insert_rowid();
        self.get_palace_row(id)
    }

    /// Apply a partial update. `None` fields are left untouched. Returns
    /// the refreshed palace row.
    pub fn update(
        &self,
        id: i64,
        name: Option<&str>,
        description: Option<Option<&str>>,
        template: Option<&str>,
        now: i64,
    ) -> AppResult<Palace> {
        // Ensure the row exists for a nicer error.
        let _ = self.get_palace_row(id)?;

        if let Some(name) = name {
            if name.trim().is_empty() {
                return Err(AppError::Validation("palace name must not be empty".into()));
            }
            self.conn.execute(
                "UPDATE palaces SET name = ?1, updated_at = ?2 WHERE id = ?3",
                params![name, now, id],
            )?;
        }
        if let Some(desc_opt) = description {
            self.conn.execute(
                "UPDATE palaces SET description = ?1, updated_at = ?2 WHERE id = ?3",
                params![desc_opt, now, id],
            )?;
        }
        if let Some(template) = template {
            if !matches!(template, "house" | "street" | "castle" | "custom") {
                return Err(AppError::Validation(format!(
                    "template must be one of house/street/castle/custom (got {})",
                    template
                )));
            }
            self.conn.execute(
                "UPDATE palaces SET template = ?1, updated_at = ?2 WHERE id = ?3",
                params![template, now, id],
            )?;
        }
        self.get_palace_row(id)
    }

    /// Delete a palace. Loci cascade via FK.
    pub fn delete(&self, id: i64) -> AppResult<()> {
        let affected = self
            .conn
            .execute("DELETE FROM palaces WHERE id = ?1", params![id])?;
        if affected == 0 {
            return Err(AppError::NotFound(format!("palace id={}", id)));
        }
        Ok(())
    }

    /// Pin a card to a locus. `ordinal` is auto-assigned to `max + 1` so
    /// new pins land at the end of the traversal route. The
    /// `UNIQUE(palace_id, card_id)` constraint surfaces a Database error
    /// if the card is already pinned in this palace.
    // One parameter per locus column (ids + x/y/z + label); a struct would
    // not remove any of them.
    #[allow(clippy::too_many_arguments)]
    pub fn add_locus(
        &self,
        palace_id: i64,
        card_id: i64,
        x: f64,
        y: f64,
        z: f64,
        label: Option<&str>,
        now: i64,
    ) -> AppResult<PalaceLocus> {
        // Validate parents exist for nicer errors than a raw FK violation.
        let palace_exists: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM palaces WHERE id = ?1",
            params![palace_id],
            |r| r.get(0),
        )?;
        if palace_exists == 0 {
            return Err(AppError::NotFound(format!("palace id={}", palace_id)));
        }
        let card_exists: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM cards WHERE id = ?1",
            params![card_id],
            |r| r.get(0),
        )?;
        if card_exists == 0 {
            return Err(AppError::NotFound(format!("card id={}", card_id)));
        }

        // Next ordinal = max + 1 (1-based for human readability; first
        // pinned locus is ordinal 1).
        let next_ordinal: i64 = self.conn.query_row(
            "SELECT COALESCE(MAX(ordinal), 0) + 1 FROM palace_loci WHERE palace_id = ?1",
            params![palace_id],
            |r| r.get(0),
        )?;

        self.conn.execute(
            "INSERT INTO palace_loci
                (palace_id, card_id, x, y, z, ordinal, label, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![palace_id, card_id, x, y, z, next_ordinal, label, now],
        )?;
        let id = self.conn.last_insert_rowid();
        self.get_locus(id)
    }

    /// Remove a single locus by id (no ordinal compaction — gaps in the
    /// sequence are harmless because traversal still respects ascending
    /// order, and `reorder_loci` rewrites contiguous ordinals when needed).
    pub fn remove_locus(&self, locus_id: i64) -> AppResult<()> {
        let affected = self
            .conn
            .execute("DELETE FROM palace_loci WHERE id = ?1", params![locus_id])?;
        if affected == 0 {
            return Err(AppError::NotFound(format!("locus id={}", locus_id)));
        }
        Ok(())
    }

    /// Rewrite the ordinals of every locus in a palace so they match the
    /// caller-provided order. `new_order` is a vec of locus ids in the
    /// intended traversal sequence; ordinals are reassigned 1..=N.
    ///
    /// Mismatch (missing or extra ids) returns a Validation error so the
    /// UI can avoid a half-applied reorder.
    pub fn reorder_loci(&self, palace_id: i64, new_order: &[i64]) -> AppResult<()> {
        // Confirm the palace exists.
        let palace_exists: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM palaces WHERE id = ?1",
            params![palace_id],
            |r| r.get(0),
        )?;
        if palace_exists == 0 {
            return Err(AppError::NotFound(format!("palace id={}", palace_id)));
        }

        // Load current loci ids.
        let mut stmt = self
            .conn
            .prepare("SELECT id FROM palace_loci WHERE palace_id = ?1 ORDER BY ordinal ASC")?;
        let mut existing: Vec<i64> = Vec::new();
        for r in stmt.query_map(params![palace_id], |row| row.get::<_, i64>(0))? {
            existing.push(r?);
        }

        if existing.len() != new_order.len() {
            return Err(AppError::Validation(format!(
                "reorder_loci: expected {} ids, got {}",
                existing.len(),
                new_order.len()
            )));
        }
        let mut sorted_existing = existing.clone();
        sorted_existing.sort_unstable();
        let mut sorted_new: Vec<i64> = new_order.to_vec();
        sorted_new.sort_unstable();
        if sorted_existing != sorted_new {
            return Err(AppError::Validation(
                "reorder_loci: id set must match existing loci".into(),
            ));
        }

        // P087 — wrap the reordering in a real transaction instead of a manual
        // SAVEPOINT/RELEASE pair. A `Transaction` from `unchecked_transaction`
        // rolls back automatically when dropped (only `commit()` persists it),
        // so an error on any UPDATE — or on commit itself — can never leave a
        // half-applied reorder, nor an open savepoint that would poison every
        // later query on this shared connection. The tx derefs to `Connection`,
        // so the same `execute` calls work unchanged.
        let tx = self.conn.unchecked_transaction()?;
        for (idx, locus_id) in new_order.iter().enumerate() {
            let new_ord = (idx as i64) + 1;
            tx.execute(
                "UPDATE palace_loci SET ordinal = ?1 WHERE id = ?2 AND palace_id = ?3",
                params![new_ord, locus_id, palace_id],
            )
            .map_err(|e| AppError::Database(format!("reorder_loci update failed: {}", e)))?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Move a locus to a new (x, y, z) anchor. The ordinal is untouched.
    pub fn move_locus(&self, locus_id: i64, x: f64, y: f64, z: f64) -> AppResult<()> {
        let affected = self.conn.execute(
            "UPDATE palace_loci SET x = ?1, y = ?2, z = ?3 WHERE id = ?4",
            params![x, y, z, locus_id],
        )?;
        if affected == 0 {
            return Err(AppError::NotFound(format!("locus id={}", locus_id)));
        }
        Ok(())
    }

    // ---- internals ---------------------------------------------------------

    fn get_palace_row(&self, id: i64) -> AppResult<Palace> {
        let palace = self
            .conn
            .query_row(
                "SELECT id, name, description, template, created_at, updated_at
                 FROM palaces WHERE id = ?1",
                params![id],
                row_to_palace,
            )
            .optional()?;
        palace.ok_or_else(|| AppError::NotFound(format!("palace id={}", id)))
    }

    fn get_locus(&self, id: i64) -> AppResult<PalaceLocus> {
        let locus = self
            .conn
            .query_row(
                "SELECT id, palace_id, card_id, x, y, z, ordinal, label, created_at
                 FROM palace_loci WHERE id = ?1",
                params![id],
                row_to_locus,
            )
            .optional()?;
        locus.ok_or_else(|| AppError::NotFound(format!("locus id={}", id)))
    }
}

fn row_to_palace(row: &Row<'_>) -> rusqlite::Result<Palace> {
    Ok(Palace {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get(2)?,
        template: row.get(3)?,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
    })
}

fn row_to_locus(row: &Row<'_>) -> rusqlite::Result<PalaceLocus> {
    Ok(PalaceLocus {
        id: row.get(0)?,
        palace_id: row.get(1)?,
        card_id: row.get(2)?,
        x: row.get(3)?,
        y: row.get(4)?,
        z: row.get(5)?,
        ordinal: row.get(6)?,
        label: row.get(7)?,
        created_at: row.get(8)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::notes::NoteTemplate;
    use crate::db::Database;
    use serde_json::json;

    fn seed_deck_and_card(db: &Database) -> i64 {
        let conn = db.lock();
        let deck = db
            .decks(&conn)
            .create("Default", None, "#3b82f6", 0.9, None, None, None)
            .unwrap();
        db.notes(&conn)
            .create(
                deck.id,
                NoteTemplate::Basic,
                json!({ "front": "Q", "back": "A" }),
                vec![],
                None,
            )
            .unwrap();
        db.cards(&conn)
            .list_in_deck(deck.id, 10, 0)
            .unwrap()
            .pop()
            .unwrap()
            .card
            .id
    }

    #[test]
    fn create_palace_persists_fields() {
        let db = Database::for_test();
        let conn = db.lock();
        let repo = PalaceRepo::new(&conn);
        let p = repo
            .create("My House", Some("Childhood home"), "house", 1_700_000_000)
            .unwrap();
        assert!(p.id > 0);
        assert_eq!(p.name, "My House");
        assert_eq!(p.description.as_deref(), Some("Childhood home"));
        assert_eq!(p.template, "house");
        assert_eq!(p.created_at, 1_700_000_000);
        assert_eq!(p.updated_at, 1_700_000_000);
    }

    #[test]
    fn create_palace_rejects_unknown_template() {
        let db = Database::for_test();
        let conn = db.lock();
        let repo = PalaceRepo::new(&conn);
        let err = repo
            .create("X", None, "spaceship", 1_700_000_000)
            .unwrap_err();
        match err {
            AppError::Validation(_) => {}
            other => panic!("expected Validation, got {:?}", other),
        }
    }

    #[test]
    fn add_locus_assigns_incremental_ordinal() {
        let db = Database::for_test();
        let card_id = seed_deck_and_card(&db);
        let conn = db.lock();
        let repo = PalaceRepo::new(&conn);
        let p = repo.create("House", None, "house", 1_700_000_000).unwrap();
        // Seed a 2nd card so we can pin two distinct cards.
        db.notes(&conn)
            .create(
                1,
                NoteTemplate::Basic,
                json!({ "front": "Q2", "back": "A2" }),
                vec![],
                None,
            )
            .unwrap();
        let card_id_2 = db
            .cards(&conn)
            .list_in_deck(1, 10, 0)
            .unwrap()
            .into_iter()
            .find(|c| c.card.id != card_id)
            .unwrap()
            .card
            .id;
        let l1 = repo
            .add_locus(p.id, card_id, 0.0, 0.0, 0.0, None, 1_700_000_001)
            .unwrap();
        let l2 = repo
            .add_locus(p.id, card_id_2, 1.0, 0.0, 0.0, None, 1_700_000_002)
            .unwrap();
        assert_eq!(l1.ordinal, 1);
        assert_eq!(l2.ordinal, 2);
    }

    #[test]
    fn unique_card_per_palace_is_enforced() {
        let db = Database::for_test();
        let card_id = seed_deck_and_card(&db);
        let conn = db.lock();
        let repo = PalaceRepo::new(&conn);
        let p = repo.create("House", None, "house", 1_700_000_000).unwrap();
        repo.add_locus(p.id, card_id, 0.0, 0.0, 0.0, None, 1_700_000_001)
            .unwrap();
        let err = repo
            .add_locus(p.id, card_id, 2.0, 0.0, 0.0, None, 1_700_000_002)
            .unwrap_err();
        // SQLite UNIQUE violation surfaces as a Database error.
        match err {
            AppError::Database(_) => {}
            other => panic!("expected Database error, got {:?}", other),
        }
    }

    #[test]
    fn delete_palace_cascades_to_loci() {
        let db = Database::for_test();
        let card_id = seed_deck_and_card(&db);
        let conn = db.lock();
        let repo = PalaceRepo::new(&conn);
        let p = repo.create("House", None, "house", 1_700_000_000).unwrap();
        repo.add_locus(p.id, card_id, 0.0, 0.0, 0.0, None, 1_700_000_001)
            .unwrap();
        let before: i64 = conn
            .query_row("SELECT COUNT(*) FROM palace_loci", [], |r| r.get(0))
            .unwrap();
        assert_eq!(before, 1);
        repo.delete(p.id).unwrap();
        let after: i64 = conn
            .query_row("SELECT COUNT(*) FROM palace_loci", [], |r| r.get(0))
            .unwrap();
        assert_eq!(after, 0);
    }

    #[test]
    fn move_locus_updates_coordinates() {
        let db = Database::for_test();
        let card_id = seed_deck_and_card(&db);
        let conn = db.lock();
        let repo = PalaceRepo::new(&conn);
        let p = repo.create("House", None, "house", 1_700_000_000).unwrap();
        let l = repo
            .add_locus(p.id, card_id, 0.0, 0.0, 0.0, None, 1_700_000_001)
            .unwrap();
        repo.move_locus(l.id, 4.0, 1.7, 2.5).unwrap();
        let refreshed = repo.get(p.id).unwrap();
        let only = &refreshed.loci[0];
        assert!((only.x - 4.0).abs() < 1e-9);
        assert!((only.y - 1.7).abs() < 1e-9);
        assert!((only.z - 2.5).abs() < 1e-9);
    }

    // P087 — a successful reorder must commit and leave NO open transaction on
    // the shared connection (the old manual SAVEPOINT could leak one). We prove
    // both: the ordinals are rewritten, and a fresh write right after still
    // succeeds (it would error with "cannot start a transaction within a
    // transaction" had the savepoint leaked).
    #[test]
    fn reorder_commits_and_leaves_connection_clean() {
        let db = Database::for_test();
        let card_id = seed_deck_and_card(&db);
        let conn = db.lock();
        let repo = PalaceRepo::new(&conn);
        let p = repo.create("House", None, "house", 1_700_000_000).unwrap();
        db.notes(&conn)
            .create(
                1,
                NoteTemplate::Basic,
                json!({ "front": "Q2", "back": "A2" }),
                vec![],
                None,
            )
            .unwrap();
        let card_id_2 = db
            .cards(&conn)
            .list_in_deck(1, 10, 0)
            .unwrap()
            .into_iter()
            .find(|c| c.card.id != card_id)
            .unwrap()
            .card
            .id;
        let l1 = repo
            .add_locus(p.id, card_id, 0.0, 0.0, 0.0, None, 1_700_000_001)
            .unwrap();
        let l2 = repo
            .add_locus(p.id, card_id_2, 1.0, 0.0, 0.0, None, 1_700_000_002)
            .unwrap();

        repo.reorder_loci(p.id, &[l2.id, l1.id]).unwrap();
        let refreshed = repo.get(p.id).unwrap();
        assert_eq!(refreshed.loci[0].id, l2.id);
        assert_eq!(refreshed.loci[0].ordinal, 1);
        assert_eq!(refreshed.loci[1].id, l1.id);
        assert_eq!(refreshed.loci[1].ordinal, 2);

        // No transaction should remain open — a new one must start cleanly.
        conn.unchecked_transaction()
            .expect("connection should be free of an open transaction after reorder");
    }
}
