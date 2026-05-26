//! Process-wide application state, shared between every Tauri command.
//!
//! Holds the SQLite [`Database`] handle plus the long-lived FSRS
//! [`CardScheduler`] used by review/preview commands. Built once during
//! `tauri::Builder::setup` and registered with `app.manage(state)`.
//!
//! Locking strategy:
//! - `db` exposes its own `Arc<Mutex<Connection>>` internally; callers grab
//!   `db.lock()` for the duration of one transaction.
//! - `scheduler` is wrapped in a `Mutex` so a future "rebuild on settings
//!   change" path can swap the inner value without invalidating the Tauri
//!   `State<'_, AppState>`.

use std::path::PathBuf;
use std::sync::Mutex;

use crate::db::Database;
use crate::error::AppResult;
use crate::fsrs::{CardScheduler, DEFAULT_DESIRED_RETENTION};

/// Aggregated state injected via `app.manage(...)` and consumed by
/// `#[tauri::command]` handlers through `tauri::State<'_, AppState>`.
pub struct AppState {
    /// Shared SQLite handle (cheap to clone — internally an `Arc`).
    pub db: Database,
    /// FSRS scheduler. The inner value is rebuilt whenever the user changes
    /// the desired retention through the settings UI.
    pub scheduler: Mutex<CardScheduler>,
}

impl AppState {
    /// Open (or create) the database at `db_path`, seed defaults, then build
    /// the FSRS scheduler from the persisted parameter vector.
    pub fn new(db_path: PathBuf) -> AppResult<Self> {
        let db = Database::init(&db_path)?;
        let params = {
            let conn = db.lock();
            db.params(&conn).get()?
        };
        let scheduler = CardScheduler::new(&params, DEFAULT_DESIRED_RETENTION)?;
        Ok(Self {
            db,
            scheduler: Mutex::new(scheduler),
        })
    }

    /// Replace the active scheduler. Called when the user adjusts retention
    /// from the settings page. Returns the previous retention so the caller
    /// can decide whether re-build was necessary.
    pub fn rebuild_scheduler(&self, desired_retention: f32) -> AppResult<()> {
        let params = {
            let conn = self.db.lock();
            self.db.params(&conn).get()?
        };
        let new_scheduler = CardScheduler::new(&params, desired_retention)?;
        let mut guard = self
            .scheduler
            .lock()
            .expect("scheduler mutex poisoned");
        *guard = new_scheduler;
        Ok(())
    }
}
