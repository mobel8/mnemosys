//! Gamification repository — streaks, freezes, achievements.
//!
//! White Hat (Octalysis) design:
//! - Streaks are **earned**, never punished. A miss only resets the counter
//!   (never decrements past zero); the user keeps their `streak_best`.
//! - Freezes turn missed days into a "saved" day so learners with a bad week
//!   don't lose months of progress. Two are granted per calendar month (reset
//!   lazily the first time the month rolls over).
//! - Achievements are pure positive feedback. They unlock once, are
//!   idempotent on re-insert, and never expire.
//!
//! Singleton table `user_stats` lives at `id = 1` (CHECK constraint, seeded by
//! migration v4) so every read path that touches it can assume the row exists.

use chrono::{DateTime, Datelike, Duration, NaiveDate, TimeZone, Utc};
use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

/// User-wide gamification state. One row, `id = 1`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct UserStats {
    pub streak_current: i64,
    pub streak_best: i64,
    /// ISO calendar date (`YYYY-MM-DD`) of the most recent review.
    pub last_review_date: Option<String>,
    pub freeze_remaining: i64,
    /// ISO month (`YYYY-MM`) the `freeze_remaining` counter belongs to.
    pub freeze_month: Option<String>,
    pub total_reviews: i64,
    pub total_correct: i64,
}

/// A unlocked badge.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Achievement {
    pub id: i64,
    pub code: String,
    pub unlocked_at: i64,
}

/// Default freeze grant per calendar month. Two is a deliberately small
/// number: enough to cover a sick day plus an emergency, not so generous it
/// trivialises the streak.
pub const FREEZES_PER_MONTH: i64 = 2;

pub struct GamificationRepo<'a> {
    conn: &'a Connection,
}

impl<'a> GamificationRepo<'a> {
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }

    /// Read the singleton stats row. The row is seeded by migration v4 so
    /// callers may treat its absence as an internal error.
    pub fn get_user_stats(&self) -> AppResult<UserStats> {
        self.conn
            .query_row(
                "SELECT streak_current, streak_best, last_review_date,
                        freeze_remaining, freeze_month, total_reviews, total_correct
                 FROM user_stats WHERE id = 1",
                [],
                row_to_user_stats,
            )
            .map_err(|e| AppError::Database(format!("user_stats singleton missing: {}", e)))
    }

    /// Record one review. Updates the streak (incremented for a new day,
    /// preserved for the same day, optionally rescued by a freeze for a
    /// 2-day gap, otherwise reset to 1), `total_reviews`, and `total_correct`
    /// when the review was passed.
    ///
    /// `reviewed_at_ts` is a unix timestamp in **seconds** (UTC). `correct`
    /// reflects whether the rating was Good/Easy (`>=2` in the FSRS scale).
    pub fn update_on_review(&self, reviewed_at_ts: i64, correct: bool) -> AppResult<UserStats> {
        let now_dt = unix_seconds_to_utc(reviewed_at_ts)?;
        let today = now_dt.date_naive();
        let stats = self.refresh_freeze_for_month(now_dt)?;

        let (new_streak, new_freeze) = compute_streak_progress(
            stats.streak_current,
            stats.last_review_date.as_deref(),
            stats.freeze_remaining,
            today,
        )?;

        let new_best = stats.streak_best.max(new_streak);
        let inc_correct = if correct { 1 } else { 0 };

        self.conn.execute(
            "UPDATE user_stats
             SET streak_current = ?1,
                 streak_best = ?2,
                 last_review_date = ?3,
                 freeze_remaining = ?4,
                 total_reviews = total_reviews + 1,
                 total_correct = total_correct + ?5
             WHERE id = 1",
            params![
                new_streak,
                new_best,
                today.format("%Y-%m-%d").to_string(),
                new_freeze,
                inc_correct,
            ],
        )?;

        self.get_user_stats()
    }

    /// Manually burn a freeze. Used by the UI when the learner taps "save my
    /// streak" the day after a miss. Errors with `Validation` when no freeze
    /// is available.
    pub fn use_freeze(&self) -> AppResult<UserStats> {
        let now_dt = Utc::now();
        let stats = self.refresh_freeze_for_month(now_dt)?;
        if stats.freeze_remaining <= 0 {
            return Err(AppError::Validation(
                "no freeze remaining this month".into(),
            ));
        }
        // Decrement and bump `last_review_date` so the next review tomorrow
        // sees a 1-day gap (= continue, not reset).
        let today = now_dt.date_naive();
        self.conn.execute(
            "UPDATE user_stats
             SET freeze_remaining = freeze_remaining - 1,
                 last_review_date = ?1
             WHERE id = 1",
            params![today.format("%Y-%m-%d").to_string()],
        )?;
        self.get_user_stats()
    }

    /// All unlocked achievements, most recent first.
    pub fn list_achievements(&self) -> AppResult<Vec<Achievement>> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, code, unlocked_at FROM achievements ORDER BY unlocked_at DESC")?;
        let rows = stmt.query_map([], row_to_achievement)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    /// Unlock an achievement. Idempotent (relies on the `UNIQUE` on `code`).
    /// Returns `true` if the row was newly inserted, `false` otherwise.
    pub fn unlock_achievement(&self, code: &str, now_ts: i64) -> AppResult<bool> {
        let affected = self.conn.execute(
            "INSERT OR IGNORE INTO achievements (code, unlocked_at) VALUES (?1, ?2)",
            params![code, now_ts],
        )?;
        Ok(affected > 0)
    }

    // ---- internals --------------------------------------------------------

    /// Lazily reset the per-month freeze counter when the calendar month rolls
    /// over. Returns the *post-refresh* stats. Idempotent within a month.
    fn refresh_freeze_for_month(&self, now_dt: DateTime<Utc>) -> AppResult<UserStats> {
        let current_month = now_dt.format("%Y-%m").to_string();
        let stats = self.get_user_stats()?;
        let needs_reset = match stats.freeze_month.as_deref() {
            Some(m) => m != current_month,
            None => true,
        };
        if needs_reset {
            self.conn.execute(
                "UPDATE user_stats
                 SET freeze_remaining = ?1, freeze_month = ?2
                 WHERE id = 1",
                params![FREEZES_PER_MONTH, current_month],
            )?;
            return self.get_user_stats();
        }
        Ok(stats)
    }
}

/// Pure function: given the current streak, last-review-date and remaining
/// freezes, decide how many freezes to burn and what the new streak is for a
/// review logged on `today`.
///
/// Behaviour:
/// - `last_review_date is None` → first review ever: streak = 1.
/// - `today == last`            → same calendar day: streak unchanged.
/// - `today == last + 1 day`    → consecutive day: streak += 1.
/// - `today == last + 2 days` and a freeze is available → burn 1, streak += 1
///   (we "saved" the missing day).
/// - Any larger gap                                     → streak resets to 1.
fn compute_streak_progress(
    streak_current: i64,
    last_review_date: Option<&str>,
    freeze_remaining: i64,
    today: NaiveDate,
) -> AppResult<(i64, i64)> {
    let Some(last_str) = last_review_date else {
        return Ok((1, freeze_remaining));
    };
    let last = NaiveDate::parse_from_str(last_str, "%Y-%m-%d")
        .map_err(|e| AppError::Database(format!("bad last_review_date {}: {}", last_str, e)))?;

    if today < last {
        // Clock skew or test data — be defensive: don't decrement, just keep state.
        return Ok((streak_current.max(1), freeze_remaining));
    }

    let gap = (today - last).num_days();
    if gap == 0 {
        // Already counted today; preserve current streak (minimum 1 so the
        // very-first-review case still flips it on).
        return Ok((streak_current.max(1), freeze_remaining));
    }
    if gap == 1 {
        return Ok((streak_current + 1, freeze_remaining));
    }
    if gap == 2 && freeze_remaining > 0 {
        // Burn one freeze, treat as consecutive day.
        return Ok((streak_current + 1, freeze_remaining - 1));
    }
    // Streak broken.
    Ok((1, freeze_remaining))
}

fn unix_seconds_to_utc(ts: i64) -> AppResult<DateTime<Utc>> {
    Utc.timestamp_opt(ts, 0)
        .single()
        .ok_or_else(|| AppError::Validation(format!("invalid unix timestamp {}", ts)))
}

fn row_to_user_stats(row: &Row<'_>) -> rusqlite::Result<UserStats> {
    Ok(UserStats {
        streak_current: row.get(0)?,
        streak_best: row.get(1)?,
        last_review_date: row.get(2)?,
        freeze_remaining: row.get(3)?,
        freeze_month: row.get(4)?,
        total_reviews: row.get(5)?,
        total_correct: row.get(6)?,
    })
}

fn row_to_achievement(row: &Row<'_>) -> rusqlite::Result<Achievement> {
    Ok(Achievement {
        id: row.get(0)?,
        code: row.get(1)?,
        unlocked_at: row.get(2)?,
    })
}

// Re-export some chrono helpers so tests in other modules can ignore the import path.
pub use chrono::NaiveDate as DateLike;

#[allow(dead_code)]
pub fn days_in_month(year: i32, month: u32) -> u32 {
    // First day of next month - 1 day = last day of this month.
    let next_month = if month == 12 {
        NaiveDate::from_ymd_opt(year + 1, 1, 1)
    } else {
        NaiveDate::from_ymd_opt(year, month + 1, 1)
    };
    next_month
        .map(|d| (d - Duration::days(1)).day())
        .unwrap_or(31)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn streak_starts_at_one_on_first_review() {
        let today = NaiveDate::from_ymd_opt(2025, 1, 5).unwrap();
        let (streak, freeze) = compute_streak_progress(0, None, 2, today).unwrap();
        assert_eq!(streak, 1);
        assert_eq!(freeze, 2);
    }

    #[test]
    fn streak_unchanged_for_same_day_review() {
        let today = NaiveDate::from_ymd_opt(2025, 1, 5).unwrap();
        let (streak, freeze) = compute_streak_progress(7, Some("2025-01-05"), 2, today).unwrap();
        assert_eq!(streak, 7);
        assert_eq!(freeze, 2);
    }

    #[test]
    fn streak_increments_on_consecutive_day() {
        let today = NaiveDate::from_ymd_opt(2025, 1, 6).unwrap();
        let (streak, freeze) = compute_streak_progress(7, Some("2025-01-05"), 2, today).unwrap();
        assert_eq!(streak, 8);
        assert_eq!(freeze, 2);
    }

    #[test]
    fn two_day_gap_consumes_freeze() {
        let today = NaiveDate::from_ymd_opt(2025, 1, 7).unwrap();
        let (streak, freeze) = compute_streak_progress(7, Some("2025-01-05"), 2, today).unwrap();
        assert_eq!(streak, 8);
        assert_eq!(freeze, 1);
    }

    #[test]
    fn two_day_gap_without_freeze_resets() {
        let today = NaiveDate::from_ymd_opt(2025, 1, 7).unwrap();
        let (streak, freeze) = compute_streak_progress(7, Some("2025-01-05"), 0, today).unwrap();
        assert_eq!(streak, 1);
        assert_eq!(freeze, 0);
    }

    #[test]
    fn three_day_gap_resets_even_with_freezes() {
        let today = NaiveDate::from_ymd_opt(2025, 1, 8).unwrap();
        let (streak, freeze) = compute_streak_progress(7, Some("2025-01-05"), 2, today).unwrap();
        assert_eq!(streak, 1);
        assert_eq!(freeze, 2);
    }
}
