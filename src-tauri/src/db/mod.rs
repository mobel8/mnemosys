//! Database layer (SQLite via rusqlite).
//!
//! Architecture
//! ============
//! - **One** SQLite [`Connection`] per running process, wrapped in
//!   `Arc<Mutex<…>>` so async Tauri commands can `lock()` it on demand. SQLite
//!   itself serialises writers via WAL, so a single mutex is plenty for a
//!   desktop app with at most a handful of concurrent in-flight commands.
//! - WAL mode + `synchronous=NORMAL` + `foreign_keys=ON` are set on every
//!   open. They survive across connections in the same DB file.
//! - Migrations live in [`migrations`] and are run unconditionally in
//!   [`Database::open`] / [`Database::for_test`].
//!
//! Usage from Tauri commands (B-wave)
//! ----------------------------------
//! ```ignore
//! use crate::db::Database;
//! use tauri::State;
//!
//! #[tauri::command]
//! async fn list_decks(db: State<'_, Database>) -> AppResult<Vec<Deck>> {
//!     let conn = db.conn.lock().unwrap();
//!     db.decks(&conn).list()
//! }
//! ```
//! `Database` is `Clone` (it's just an `Arc` under the hood) and `Send + Sync`,
//! so it can be registered with `app.manage(database)` in `lib.rs::run()`.

use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard};

use rusqlite::Connection;

use crate::error::{AppError, AppResult};

pub mod cards;
pub mod decks;
pub mod gamification;
pub mod migrations;
pub mod notes;
pub mod params;
pub mod reviews;
pub mod wellness;

pub use cards::{Card, CardRepo, CardState, CardWithNote};
pub use decks::{Deck, DeckMastery, DeckPatch, DeckRepo, DeckStats};
pub use gamification::{Achievement, GamificationRepo, UserStats};
pub use notes::{Note, NoteRepo, NoteTemplate};
pub use params::ParamsRepo;
pub use reviews::{DayCount, DayRetention, NewReview, Review, ReviewRepo};
pub use wellness::{WellnessLog, WellnessRepo};

/// Default 21-element FSRS-5 parameter vector. Used as the seed value on a
/// brand-new database. Agent A3 may overwrite this whenever an optimisation
/// run completes. These are the canonical FSRS-5 defaults shipped by the
/// upstream `fsrs` crate; safe to use until the user has enough reviews
/// (~1k) for a custom fit.
pub const DEFAULT_FSRS_PARAMS: [f32; 21] = [
    0.4, 0.6, 2.4, 5.8, 4.93, 0.94, 0.86, 0.01, 1.49, 0.14, 0.94, 2.18, 0.05, 0.34, 1.26, 0.29,
    2.61, 0.5, 0.1, 0.07, 0.15,
];

/// Process-wide DB handle. Cheap to clone (just bumps an `Arc` refcount).
#[derive(Clone)]
pub struct Database {
    conn: Arc<Mutex<Connection>>,
}

impl Database {
    /// Open (or create) the SQLite file at `db_path`, configure pragmas and
    /// run pending migrations. The parent directory **must** already exist —
    /// the caller (typically Tauri's setup hook) decides where the file lives.
    pub fn open(db_path: &Path) -> AppResult<Self> {
        if let Some(parent) = db_path.parent() {
            if !parent.as_os_str().is_empty() && !parent.exists() {
                std::fs::create_dir_all(parent)?;
            }
        }
        let conn = Connection::open(db_path)?;
        configure_connection(&conn)?;
        migrations::run(&conn)?;
        seed_defaults(&conn)?;
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    /// Backwards-compatible alias matching the original spec name. Prefer
    /// [`Database::open`] in new code.
    pub fn init(db_path: &Path) -> AppResult<Self> {
        Self::open(db_path)
    }

    /// In-memory database — used by unit/integration tests.
    pub fn for_test() -> Self {
        let conn = Connection::open_in_memory().expect("open in-memory sqlite");
        configure_connection(&conn).expect("configure in-memory sqlite");
        migrations::run(&conn).expect("run migrations on in-memory sqlite");
        seed_defaults(&conn).expect("seed defaults on in-memory sqlite");
        Self {
            conn: Arc::new(Mutex::new(conn)),
        }
    }

    /// Lock the underlying connection. Panics only if the mutex is poisoned —
    /// which would mean another thread panicked while holding the lock, in
    /// which case the DB is likely unusable anyway.
    pub fn lock(&self) -> MutexGuard<'_, Connection> {
        self.conn.lock().expect("database mutex poisoned")
    }

    // ---- repository accessors ------------------------------------------------
    //
    // Each accessor takes the active connection guard by reference and returns
    // a short-lived repository wrapper. Pattern from a Tauri command:
    //
    //     let conn = db.lock();
    //     let decks = db.decks(&conn).list()?;
    //
    // Repositories never own the connection, so multiple repos can be obtained
    // from the same guard inside a single critical section.

    pub fn decks<'a>(&self, conn: &'a Connection) -> DeckRepo<'a> {
        DeckRepo::new(conn)
    }
    pub fn notes<'a>(&self, conn: &'a Connection) -> NoteRepo<'a> {
        NoteRepo::new(conn)
    }
    pub fn cards<'a>(&self, conn: &'a Connection) -> CardRepo<'a> {
        CardRepo::new(conn)
    }
    pub fn reviews<'a>(&self, conn: &'a Connection) -> ReviewRepo<'a> {
        ReviewRepo::new(conn)
    }
    pub fn params<'a>(&self, conn: &'a Connection) -> ParamsRepo<'a> {
        ParamsRepo::new(conn)
    }

    pub fn gamification<'a>(&self, conn: &'a Connection) -> GamificationRepo<'a> {
        GamificationRepo::new(conn)
    }

    pub fn wellness<'a>(&self, conn: &'a Connection) -> WellnessRepo<'a> {
        WellnessRepo::new(conn)
    }
}

/// Apply the pragmas every connection needs. Called once at open time.
fn configure_connection(conn: &Connection) -> AppResult<()> {
    // foreign_keys is per-connection — re-enabling on each open is mandatory.
    conn.pragma_update(None, "foreign_keys", "ON")?;
    // WAL is persistent for the file but enabling it is cheap and idempotent.
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    // Reasonable default; B-wave can override if a long-running write needs more.
    conn.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| AppError::Database(format!("busy_timeout: {}", e)))?;
    Ok(())
}

/// Seed the singleton tables if they're empty (idempotent).
fn seed_defaults(conn: &Connection) -> AppResult<()> {
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM fsrs_params", [], |r| r.get(0))?;
    if count == 0 {
        let json = serde_json::to_string(&DEFAULT_FSRS_PARAMS.to_vec())?;
        conn.execute(
            "INSERT INTO fsrs_params (id, params_json, optimized_at, reviews_at_optim)
             VALUES (1, ?1, NULL, 0)",
            rusqlite::params![json],
        )?;
    }
    Ok(())
}
