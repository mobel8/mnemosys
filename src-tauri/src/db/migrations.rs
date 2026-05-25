//! SQLite schema migrations.
//!
//! Versioning relies on SQLite's `PRAGMA user_version`. Each future migration
//! bumps the version by 1 and is applied conditionally. Session 1 ships only
//! v1 (the initial schema embedded as `schema.sql`).
//!
//! Migration files are embedded at compile time via `include_str!`, which
//! means the binary is fully self-contained — no external `.sql` to ship.

use rusqlite::Connection;

use crate::error::{AppError, AppResult};

/// Current schema version. Bump when adding a new migration.
pub const CURRENT_VERSION: i32 = 1;

/// Initial schema (v1).
const SCHEMA_V1: &str = include_str!("schema.sql");

/// Apply all pending migrations to `conn`.
///
/// Reads `PRAGMA user_version` and applies migrations in order. Each migration
/// is wrapped in a transaction so it either fully succeeds or fully rolls back
/// (the schema file may execute multiple statements via `execute_batch`).
pub fn run(conn: &Connection) -> AppResult<()> {
    let current: i32 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;

    if current == CURRENT_VERSION {
        return Ok(());
    }

    if current > CURRENT_VERSION {
        // Likely a future build was opened on this DB. Refuse to downgrade.
        log::warn!(
            "Database user_version={} is newer than supported version {}. Skipping migrations.",
            current,
            CURRENT_VERSION
        );
        return Ok(());
    }

    // Apply v1 if missing.
    if current < 1 {
        apply_migration(conn, 1, SCHEMA_V1)?;
    }

    // Future migrations:
    // if current < 2 { apply_migration(conn, 2, SCHEMA_V2)?; }

    Ok(())
}

/// Run `sql` inside a transaction and bump `user_version` to `version`.
fn apply_migration(conn: &Connection, version: i32, sql: &str) -> AppResult<()> {
    log::info!("Applying DB migration v{}", version);

    conn.execute_batch("BEGIN;")?;

    if let Err(e) = conn.execute_batch(sql) {
        // Best-effort rollback; if it fails too we still surface the original error.
        let _ = conn.execute_batch("ROLLBACK;");
        return Err(AppError::Database(format!(
            "migration v{} failed: {}",
            version, e
        )));
    }

    // `PRAGMA user_version = ?` does not accept bind params, so format literally.
    // `version` is a hard-coded i32 controlled by this crate — no injection risk.
    conn.execute_batch(&format!("PRAGMA user_version = {};", version))?;
    conn.execute_batch("COMMIT;")?;

    Ok(())
}
