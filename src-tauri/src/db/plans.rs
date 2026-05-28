//! Study-plan repository — Implementation Intentions (Vague 21).
//!
//! Gollwitzer's « si [situation] alors [action] » plans (1999 meta, d≈0.65)
//! roughly double the rate at which an intention turns into behaviour. Each
//! row pairs a trigger (a clock time, a place, or an existing habit) with a
//! concrete study action and an optional deck.
//!
//! `days` is stored as a JSON array of ISO weekday ints (`1`=Mon … `7`=Sun).
//! An empty array means « every day ». `deck_id` is a *soft* reference (no FK)
//! so deleting a deck never deletes the learner's plan. `created_at` is filled
//! by the caller so tests can pin the wall-clock timestamp (mirrors
//! `wellness.rs` / `gamification.rs`).

use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};

use crate::error::AppResult;

/// One study plan. Mirrors the `study_plans` table 1-1.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct StudyPlan {
    pub id: i64,
    /// `'time'` | `'place'` | `'after_habit'`.
    pub trigger_type: String,
    /// The cue payload: `'19:00'` for time, a label otherwise.
    pub trigger_value: String,
    /// What the learner commits to doing, e.g. « Réviser Espagnol 15 min ».
    pub action: String,
    /// Optional soft reference to the deck this plan reviews.
    pub deck_id: Option<i64>,
    /// JSON array of ISO weekday ints (`[1,3,5]`); `[]` means every day.
    pub days: String,
    /// Whether the plan is active (drives notification scheduling).
    pub enabled: bool,
    /// Unix-seconds timestamp (UTC) at which the row was inserted.
    pub created_at: i64,
}

pub struct PlanRepo<'a> {
    conn: &'a Connection,
}

impl<'a> PlanRepo<'a> {
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }

    /// Every plan, newest first.
    pub fn list(&self) -> AppResult<Vec<StudyPlan>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, trigger_type, trigger_value, action, deck_id, days, enabled, created_at
             FROM study_plans
             ORDER BY created_at DESC, id DESC",
        )?;
        let rows = stmt.query_map([], row_to_plan)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    /// Insert a new plan. `days` is a JSON array string; the caller is
    /// responsible for passing valid JSON (the command layer validates it).
    #[allow(clippy::too_many_arguments)]
    pub fn create(
        &self,
        trigger_type: &str,
        trigger_value: &str,
        action: &str,
        deck_id: Option<i64>,
        days: &str,
        enabled: bool,
        created_at: i64,
    ) -> AppResult<StudyPlan> {
        self.conn.execute(
            "INSERT INTO study_plans
                (trigger_type, trigger_value, action, deck_id, days, enabled, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                trigger_type,
                trigger_value,
                action,
                deck_id,
                days,
                enabled as i64,
                created_at,
            ],
        )?;
        let id = self.conn.last_insert_rowid();
        Ok(StudyPlan {
            id,
            trigger_type: trigger_type.to_string(),
            trigger_value: trigger_value.to_string(),
            action: action.to_string(),
            deck_id,
            days: days.to_string(),
            enabled,
            created_at,
        })
    }

    /// Overwrite the mutable fields of an existing plan. `enabled` is updated
    /// here too; `toggle` is a convenience that flips it without re-sending
    /// the rest. Returns the refreshed row.
    #[allow(clippy::too_many_arguments)]
    pub fn update(
        &self,
        id: i64,
        trigger_type: &str,
        trigger_value: &str,
        action: &str,
        deck_id: Option<i64>,
        days: &str,
        enabled: bool,
    ) -> AppResult<StudyPlan> {
        self.conn.execute(
            "UPDATE study_plans
             SET trigger_type = ?2, trigger_value = ?3, action = ?4,
                 deck_id = ?5, days = ?6, enabled = ?7
             WHERE id = ?1",
            params![
                id,
                trigger_type,
                trigger_value,
                action,
                deck_id,
                days,
                enabled as i64,
            ],
        )?;
        self.get(id)
    }

    /// Flip the `enabled` flag and return the refreshed row.
    pub fn toggle(&self, id: i64, enabled: bool) -> AppResult<StudyPlan> {
        self.conn.execute(
            "UPDATE study_plans SET enabled = ?2 WHERE id = ?1",
            params![id, enabled as i64],
        )?;
        self.get(id)
    }

    /// Delete a plan. No-op if it doesn't exist.
    pub fn delete(&self, id: i64) -> AppResult<()> {
        self.conn
            .execute("DELETE FROM study_plans WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// Fetch a single plan by id.
    pub fn get(&self, id: i64) -> AppResult<StudyPlan> {
        let mut stmt = self.conn.prepare(
            "SELECT id, trigger_type, trigger_value, action, deck_id, days, enabled, created_at
             FROM study_plans
             WHERE id = ?1",
        )?;
        let mut rows = stmt.query(params![id])?;
        match rows.next()? {
            Some(row) => row_to_plan(row).map_err(Into::into),
            None => Err(crate::error::AppError::NotFound(format!(
                "study_plan id={id}"
            ))),
        }
    }
}

fn row_to_plan(row: &Row<'_>) -> rusqlite::Result<StudyPlan> {
    let enabled: i64 = row.get(6)?;
    Ok(StudyPlan {
        id: row.get(0)?,
        trigger_type: row.get(1)?,
        trigger_value: row.get(2)?,
        action: row.get(3)?,
        deck_id: row.get(4)?,
        days: row.get(5)?,
        enabled: enabled != 0,
        created_at: row.get(7)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;

    #[test]
    fn study_plan_round_trip() {
        let db = Database::for_test();
        let conn = db.lock();
        let repo = PlanRepo::new(&conn);

        let created = repo
            .create(
                "time",
                "19:00",
                "Réviser le deck Espagnol 15 min",
                Some(3),
                "[1,2,3,4,5]",
                true,
                1_700_000_000,
            )
            .expect("create");
        assert!(created.id > 0);
        assert_eq!(created.trigger_type, "time");
        assert_eq!(created.trigger_value, "19:00");
        assert_eq!(created.deck_id, Some(3));
        assert_eq!(created.days, "[1,2,3,4,5]");
        assert!(created.enabled);

        // It must come back through list() identically.
        let all = repo.list().expect("list");
        assert_eq!(all.len(), 1);
        assert_eq!(all[0], created);

        // Update mutates the stored fields.
        let updated = repo
            .update(
                created.id,
                "place",
                "bureau",
                "Réviser 10 min",
                None,
                "[]",
                false,
            )
            .expect("update");
        assert_eq!(updated.trigger_type, "place");
        assert_eq!(updated.trigger_value, "bureau");
        assert_eq!(updated.deck_id, None);
        assert_eq!(updated.days, "[]");
        assert!(!updated.enabled);
        assert_eq!(
            updated.created_at, created.created_at,
            "created_at preserved"
        );

        // Delete removes it.
        repo.delete(created.id).expect("delete");
        assert!(repo.list().expect("list").is_empty());
    }

    #[test]
    fn toggle_study_plan() {
        let db = Database::for_test();
        let conn = db.lock();
        let repo = PlanRepo::new(&conn);

        let plan = repo
            .create(
                "after_habit",
                "après le café",
                "Réviser",
                None,
                "[]",
                true,
                1,
            )
            .expect("create");
        assert!(plan.enabled);

        let off = repo.toggle(plan.id, false).expect("toggle off");
        assert!(!off.enabled);
        assert_eq!(off.id, plan.id);

        let on = repo.toggle(plan.id, true).expect("toggle on");
        assert!(on.enabled);
    }

    #[test]
    fn get_missing_plan_errors() {
        let db = Database::for_test();
        let conn = db.lock();
        let repo = PlanRepo::new(&conn);
        assert!(repo.get(999).is_err());
    }

    #[test]
    fn deck_id_survives_deck_deletion() {
        // deck_id is a soft reference (no FK), so the plan persists even after
        // the referenced deck row is gone.
        let db = Database::for_test();
        let conn = db.lock();
        let now = chrono::Utc::now().timestamp();
        conn.execute(
            "INSERT INTO decks (id, name, color, desired_retention, created_at, updated_at)
             VALUES (42, 'Tmp', '#3b82f6', 0.9, ?1, ?1)",
            params![now],
        )
        .expect("seed deck");

        let repo = PlanRepo::new(&conn);
        let plan = repo
            .create("time", "08:00", "Réviser", Some(42), "[]", true, now)
            .expect("create");

        conn.execute("DELETE FROM decks WHERE id = 42", [])
            .expect("delete deck");

        let still = repo.get(plan.id).expect("plan still exists");
        assert_eq!(still.deck_id, Some(42));
    }
}
