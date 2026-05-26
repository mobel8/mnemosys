//! Wellness repository — pre-session check-in logs (Vague 3, opt-in).
//!
//! Every column except `id`, `date`, `hydrated`, `caffeine_taken` and
//! `created_at` is **NULL-able by design**: the learner can answer one,
//! several, or zero questions and the row still persists. The frontend
//! never imputes a default — a skipped slider becomes a `None`.
//!
//! Lookups are date-based (`YYYY-MM-DD`) so the calling code can ask
//! « has the user logged a check-in *today* ? » without TZ arithmetic.
//! The `created_at` unix-seconds column preserves wall-clock ordering
//! whenever multiple rows share the same calendar day.

use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};

use crate::error::AppResult;

/// One wellness snapshot. Mirrors the `wellness_logs` table 1-1.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WellnessLog {
    pub id: i64,
    /// ISO calendar date (`YYYY-MM-DD`) of the check-in.
    pub date: String,
    /// Self-reported mood `[1..5]`. `None` when the learner skipped that field.
    pub mood: Option<i64>,
    /// Hours of sleep the previous night `[0.0..12.0]`. `None` when skipped.
    pub sleep_hours: Option<f64>,
    /// Self-reported stress `[1..5]`. `None` when skipped.
    pub stress_level: Option<i64>,
    /// `true` when the learner ticked "hydrated".
    pub hydrated: bool,
    /// `true` when the learner ticked "caffeine taken".
    pub caffeine_taken: bool,
    /// Unix-seconds timestamp (UTC) at which the row was inserted.
    pub created_at: i64,
}

pub struct WellnessRepo<'a> {
    conn: &'a Connection,
}

impl<'a> WellnessRepo<'a> {
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }

    /// Persist a brand-new check-in. `created_at` is filled by the caller so
    /// tests can pin the wall-clock timestamp (mirrors `gamification.rs`).
    pub fn insert_log(
        &self,
        date: &str,
        mood: Option<i64>,
        sleep_hours: Option<f64>,
        stress_level: Option<i64>,
        hydrated: bool,
        caffeine_taken: bool,
        created_at: i64,
    ) -> AppResult<WellnessLog> {
        self.conn.execute(
            "INSERT INTO wellness_logs
                (date, mood, sleep_hours, stress_level, hydrated, caffeine_taken, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                date,
                mood,
                sleep_hours,
                stress_level,
                hydrated as i64,
                caffeine_taken as i64,
                created_at,
            ],
        )?;
        let id = self.conn.last_insert_rowid();
        Ok(WellnessLog {
            id,
            date: date.to_string(),
            mood,
            sleep_hours,
            stress_level,
            hydrated,
            caffeine_taken,
            created_at,
        })
    }

    /// Most recent log overall (newest `created_at` first). `None` on a brand-new
    /// install or when neuro modes have never been used.
    pub fn latest_log(&self) -> AppResult<Option<WellnessLog>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, date, mood, sleep_hours, stress_level, hydrated, caffeine_taken, created_at
             FROM wellness_logs
             ORDER BY created_at DESC
             LIMIT 1",
        )?;
        let mut rows = stmt.query([])?;
        match rows.next()? {
            Some(row) => Ok(Some(row_to_wellness_log(row)?)),
            None => Ok(None),
        }
    }

    /// Find the **latest** log for a specific calendar day. Returning the most
    /// recent row (rather than the first) means a learner who edits their
    /// check-in later in the day sees the updated values.
    pub fn log_for_date(&self, date: &str) -> AppResult<Option<WellnessLog>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, date, mood, sleep_hours, stress_level, hydrated, caffeine_taken, created_at
             FROM wellness_logs
             WHERE date = ?1
             ORDER BY created_at DESC
             LIMIT 1",
        )?;
        let mut rows = stmt.query(params![date])?;
        match rows.next()? {
            Some(row) => Ok(Some(row_to_wellness_log(row)?)),
            None => Ok(None),
        }
    }

    /// Last `days` of logs, newest first. Used by future analytics; clamps to
    /// `>=1` so a caller asking for 0 still gets a sensible answer.
    pub fn recent_logs(&self, days: i64) -> AppResult<Vec<WellnessLog>> {
        let limit = days.max(1);
        let mut stmt = self.conn.prepare(
            "SELECT id, date, mood, sleep_hours, stress_level, hydrated, caffeine_taken, created_at
             FROM wellness_logs
             ORDER BY created_at DESC
             LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit], row_to_wellness_log)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }
}

fn row_to_wellness_log(row: &Row<'_>) -> rusqlite::Result<WellnessLog> {
    let hydrated: i64 = row.get(5)?;
    let caffeine: i64 = row.get(6)?;
    Ok(WellnessLog {
        id: row.get(0)?,
        date: row.get(1)?,
        mood: row.get(2)?,
        sleep_hours: row.get(3)?,
        stress_level: row.get(4)?,
        hydrated: hydrated != 0,
        caffeine_taken: caffeine != 0,
        created_at: row.get(7)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;

    #[test]
    fn insert_log_round_trips_fields() {
        let db = Database::for_test();
        let conn = db.lock();
        let repo = WellnessRepo::new(&conn);
        let log = repo
            .insert_log("2026-05-26", Some(4), Some(7.5), Some(2), true, false, 1_700_000_000)
            .expect("insert");
        assert_eq!(log.date, "2026-05-26");
        assert_eq!(log.mood, Some(4));
        assert_eq!(log.sleep_hours, Some(7.5));
        assert_eq!(log.stress_level, Some(2));
        assert!(log.hydrated);
        assert!(!log.caffeine_taken);
        assert_eq!(log.created_at, 1_700_000_000);
        assert!(log.id > 0);
    }

    #[test]
    fn insert_log_accepts_all_nulls() {
        let db = Database::for_test();
        let conn = db.lock();
        let repo = WellnessRepo::new(&conn);
        let log = repo
            .insert_log("2026-05-26", None, None, None, false, false, 1_700_000_000)
            .expect("insert");
        assert!(log.mood.is_none());
        assert!(log.sleep_hours.is_none());
        assert!(log.stress_level.is_none());
    }

    #[test]
    fn log_for_date_returns_latest_for_day() {
        let db = Database::for_test();
        let conn = db.lock();
        let repo = WellnessRepo::new(&conn);
        repo.insert_log("2026-05-26", Some(3), None, None, false, false, 1)
            .unwrap();
        repo.insert_log("2026-05-26", Some(5), None, None, true, false, 2)
            .unwrap();
        let log = repo
            .log_for_date("2026-05-26")
            .expect("query")
            .expect("row");
        assert_eq!(log.mood, Some(5));
        assert!(log.hydrated);
    }

    #[test]
    fn log_for_date_none_when_missing() {
        let db = Database::for_test();
        let conn = db.lock();
        let repo = WellnessRepo::new(&conn);
        assert!(repo.log_for_date("2026-05-26").unwrap().is_none());
    }
}
