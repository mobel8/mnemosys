//! P091 — production diagnostics surface.
//!
//! Two commands backing the `<ErrorBoundary>` fallback UI:
//! - [`log_frontend_error`] funnels a caught React error into the same rotating
//!   log file as the Rust side (`tauri-plugin-log`, target `LogDir`), so a user
//!   report can be traced after the fact.
//! - [`open_log_dir`] reveals that log directory in the OS file manager so a
//!   user can attach the log to a bug report without hunting for the path.

use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};

/// Record a frontend error in the persistent log. Called best-effort by the
/// error boundary; the frontend swallows failures, so this never needs to be
/// fatal. The `frontend` target tag keeps these lines greppable.
#[tauri::command]
pub fn log_frontend_error(
    message: String,
    stack: Option<String>,
    component_stack: Option<String>,
) -> AppResult<()> {
    let mut entry = format!("[frontend] {message}");
    if let Some(stack) = stack.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        entry.push_str("\n  stack: ");
        entry.push_str(stack);
    }
    if let Some(cs) = component_stack
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        entry.push_str("\n  components: ");
        entry.push_str(cs);
    }
    log::error!("{entry}");
    Ok(())
}

/// Reveal the rotating log directory in the OS file manager. Best-effort:
/// spawns the platform opener and returns once it's launched (we don't wait on
/// the GUI process). Errors only when the log dir can't be resolved or the
/// opener fails to start.
#[tauri::command]
pub fn open_log_dir(app: AppHandle) -> AppResult<()> {
    let dir = app
        .path()
        .app_log_dir()
        .map_err(|e| AppError::Other(format!("résolution du dossier de logs : {e}")))?;
    // The directory is created lazily on first log write; make sure it exists so
    // the file manager doesn't open onto nothing on a fresh install.
    if !dir.exists() {
        std::fs::create_dir_all(&dir)
            .map_err(|e| AppError::Other(format!("création du dossier de logs : {e}")))?;
    }

    #[cfg(target_os = "linux")]
    let opener = "xdg-open";
    #[cfg(target_os = "macos")]
    let opener = "open";
    #[cfg(target_os = "windows")]
    let opener = "explorer";

    std::process::Command::new(opener)
        .arg(&dir)
        .spawn()
        .map_err(|e| AppError::Other(format!("ouverture du dossier de logs : {e}")))?;
    Ok(())
}
