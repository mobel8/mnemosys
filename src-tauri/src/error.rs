//! Unified error type for the Mnemosys backend.
//!
//! Use [`AppResult<T>`] in all `#[tauri::command]` handlers — `AppError` is
//! `Serialize` so it crosses the IPC boundary cleanly and the frontend
//! receives a plain string message.

use serde::Serialize;
use thiserror::Error;

// Messages are surfaced verbatim in the (French) UI toasts via the `Serialize`
// impl below, so the human-facing prefixes are written in French. The wrapped
// `{0}` payloads can still be technical (a SQLite/serde message), but the
// prefix gives the user a localised, intelligible category.
#[derive(Debug, Error)]
pub enum AppError {
    #[error("Erreur de base de données : {0}")]
    Database(String),

    #[error("Erreur FSRS : {0}")]
    Fsrs(String),

    #[error("Erreur d'entrée/sortie : {0}")]
    Io(#[from] std::io::Error),

    #[error("Erreur de sérialisation : {0}")]
    Serde(#[from] serde_json::Error),

    #[error("Erreur de validation : {0}")]
    Validation(String),

    #[error("Introuvable : {0}")]
    NotFound(String),

    #[error("{0}")]
    Other(String),
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        AppError::Database(e.to_string())
    }
}

impl From<tauri::Error> for AppError {
    fn from(e: tauri::Error) -> Self {
        AppError::Other(e.to_string())
    }
}

/// Convenience alias used throughout the backend.
pub type AppResult<T> = Result<T, AppError>;
