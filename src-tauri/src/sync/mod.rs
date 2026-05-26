//! Session 3 cloud sync.
//!
//! This module is a **scaffolding**: every public type and function compiles,
//! is unit-testable without a network, and is wired into the Tauri command
//! handlers. Actual HTTP traffic is gated behind a configured
//! `supabase_url` + `supabase_anon_key` couple in `AppSettings`; any call
//! made before that returns `AppError::Validation`.
//!
//! See `docs/SESSION_3_SYNC.md` for the high-level design (schema, CRDT
//! strategy, conflict policy, security).
//!
//! Module map:
//! - [`auth`]   — Supabase Auth REST wrapper + JWT persistence.
//! - [`client`] — HTTP client (reqwest) for PostgREST endpoints.
//! - [`delta`]  — extract local rows changed since the last sync cursor.
//! - [`apply`]  — apply a remote changeset to the local DB with LWW merge.
//! - [`cycle`]  — orchestrator: full push → pull → resolve cycle.
//! - [`tests`]  — pure unit tests (LWW merge, delta extraction).

use serde::{Deserialize, Serialize};

pub mod apply;
pub mod auth;
pub mod client;
pub mod cycle;
pub mod delta;
#[cfg(test)]
pub mod tests;

/// Session blob persisted in `sync_session.json` via `tauri-plugin-store`.
///
/// All timestamps are unix epoch seconds. `expires_at` is the absolute
/// deadline of `access_token` — once we cross it we must refresh via
/// `refresh_token` before issuing any other call.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SyncSession {
    pub user_id: String,
    pub email: String,
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: i64,
}

/// Snapshot of the sync subsystem used by the Settings UI to decide what to
/// render: the connect form, the « not configured » banner, or the active
/// session card.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SyncStatus {
    /// `true` when both `supabase_url` and `supabase_anon_key` are set.
    pub configured: bool,
    /// `true` when a non-expired JWT lives in `sync_session.json`.
    pub logged_in: bool,
    /// Email of the active session, if any.
    pub email: Option<String>,
    /// Last successful sync timestamp (unix epoch seconds).
    pub last_sync_at: Option<i64>,
}

/// Aggregated result of one full sync cycle. Returned by the
/// `sync_now` command so the UI can show a toast like « 12 cartes envoyées,
/// 3 cartes reçues ».
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct SyncReport {
    pub decks_pushed: usize,
    pub decks_pulled: usize,
    pub notes_pushed: usize,
    pub notes_pulled: usize,
    pub cards_pushed: usize,
    pub cards_pulled: usize,
    pub reviews_pushed: usize,
    pub reviews_pulled: usize,
    /// Cursor written back to `sync_state.last_sync_at`.
    pub finished_at: i64,
}
