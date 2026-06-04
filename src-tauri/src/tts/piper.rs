//! Local, offline text-to-speech via the Piper CLI (Vague 22).
//!
//! [Piper](https://github.com/OHF-Voice/piper1-gpl) is a small neural TTS
//! engine that reads text on **stdin** and writes a WAV file to a path given
//! by `--output_file`, using a voice model stored as an ONNX file. We drive
//! it as a sidecar process through [`std::process::Command`] — no extra Cargo
//! dependency, and the heavy ONNX runtime stays out of our binary.
//!
//! Everything here fails *cleanly*: a missing binary, an unreadable model, or
//! a non-zero exit all surface as [`AppError::Other`] with an actionable
//! message (the UI shows it verbatim). We never panic and never block the UI
//! on a hung child (a generous timeout guards against that).
//!
//! Privacy: unlike the OpenAI path, nothing leaves the machine.

use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

use crate::error::{AppError, AppResult};

/// Hard ceiling on how long we wait for Piper to finish one phrase. Flashcard
/// answers are short; if synthesis hasn't completed in this window something
/// is wrong (wrong binary, model still loading from a cold cache, …) and we'd
/// rather surface an error than hang the review.
const PIPER_TIMEOUT_SECS: u64 = 60;

/// Build the argument vector handed to the Piper binary for `model`/`out_path`.
///
/// Split out from [`synthesize_piper`] so it can be unit-tested without
/// spawning a real process. Order matches Piper's documented CLI:
/// `piper --model <model> --output_file <out>` (text arrives on stdin).
pub(crate) fn piper_args(model: &str, out_path: &Path) -> Vec<String> {
    vec![
        "--model".to_string(),
        model.to_string(),
        "--output_file".to_string(),
        out_path.to_string_lossy().into_owned(),
    ]
}

/// Synthesise `text` to a WAV at `out_path` using the Piper binary at
/// `binary` and the ONNX voice model at `model`.
///
/// Contract:
/// - `binary` may be a bare name resolved via `$PATH` (e.g. `"piper"`) or an
///   absolute path.
/// - `model` must point at an existing `.onnx` voice file; we check this up
///   front so the error names the missing model rather than letting Piper emit
///   an opaque message.
/// - On success the WAV exists at `out_path` and the function returns `Ok(())`.
///
/// Any failure (spawn error, validation, non-zero exit, timeout) is mapped to
/// `AppError::Other("Piper unavailable: …")` so the frontend can show a single
/// "install Piper / pick a model" hint.
pub fn synthesize_piper(binary: &str, model: &str, text: &str, out_path: &Path) -> AppResult<()> {
    let binary = binary.trim();
    let model = model.trim();
    let text = text.trim();

    if binary.is_empty() {
        return Err(AppError::Other(
            "Piper indisponible : aucun chemin de binaire configuré (renseigne-le dans Paramètres → TTS local)."
                .to_string(),
        ));
    }
    if model.is_empty() {
        return Err(AppError::Other(
            "Piper indisponible : aucun modèle de voix configuré. Télécharge une voix .onnx depuis \
             github.com/OHF-Voice/piper1-gpl et renseigne son chemin dans Paramètres → TTS local."
                .to_string(),
        ));
    }
    if text.is_empty() {
        return Err(AppError::Validation(
            "Le texte ne doit pas être vide.".to_string(),
        ));
    }
    if !Path::new(model).is_file() {
        return Err(AppError::Other(format!(
            "Piper indisponible : modèle de voix introuvable à « {model} ». Télécharge une voix .onnx \
             et fais pointer le chemin du modèle dessus."
        )));
    }

    let mut child = Command::new(binary)
        .args(piper_args(model, out_path))
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            AppError::Other(format!(
                "Piper indisponible : impossible d'exécuter « {binary} » ({e}). Installe Piper et \
                 vérifie le chemin du binaire (un nom simple présent dans le PATH convient)."
            ))
        })?;

    // P119 — drain stderr on a dedicated thread *before* we start polling for
    // exit. A verbose Piper build can emit well over the ~64 KB pipe buffer; if
    // we only read stderr in the failure branch (after the wait loop) the child
    // blocks on a full pipe and never exits, so `try_wait` spins until the 60 s
    // timeout kills a synthesis that would otherwise have succeeded — the
    // classic pipe-full deadlock, well known for stdin but just as real for
    // stderr. Reading it concurrently keeps the pipe drained at all times.
    let stderr_handle = child.stderr.take().map(|mut s| {
        std::thread::spawn(move || {
            use std::io::Read;
            let mut buf = String::new();
            let _ = s.read_to_string(&mut buf);
            buf
        })
    });

    // Feed the text on stdin, then drop the handle so Piper sees EOF and starts
    // synthesising. Holding the handle would deadlock against a child that
    // waits for end-of-input.
    {
        let mut stdin = child.stdin.take().ok_or_else(|| {
            AppError::Other("Piper unavailable: failed to open child stdin.".to_string())
        })?;
        stdin.write_all(text.as_bytes()).map_err(|e| {
            AppError::Other(format!(
                "Piper unavailable: failed to write text to stdin ({e})."
            ))
        })?;
    }

    // Join the stderr reader once the child has been waited on. The thread ends
    // as soon as the child closes its stderr (i.e. on exit or kill), so this
    // never blocks beyond the child's own lifetime. Defaults to empty if the
    // pipe was missing or the reader thread panicked.
    let collect_stderr = |handle: Option<std::thread::JoinHandle<String>>| -> String {
        handle.and_then(|h| h.join().ok()).unwrap_or_default()
    };

    // Bounded wait. `std::process` has no native timeout, so poll `try_wait`
    // on a short interval up to the ceiling. This keeps the dependency surface
    // at zero while still protecting against a wedged child.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(PIPER_TIMEOUT_SECS);
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {
                if std::time::Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    // Reap the drainer so the thread doesn't outlive us.
                    let _ = collect_stderr(stderr_handle);
                    return Err(AppError::Other(format!(
                        "Piper unavailable: synthesis timed out after {PIPER_TIMEOUT_SECS}s."
                    )));
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            Err(e) => {
                let _ = collect_stderr(stderr_handle);
                return Err(AppError::Other(format!(
                    "Piper unavailable: failed while waiting on the process ({e})."
                )));
            }
        }
    };

    // Always join the drainer so the thread is reaped, even on success.
    let stderr = collect_stderr(stderr_handle);

    if !status.success() {
        let detail = stderr.trim();
        let suffix = if detail.is_empty() {
            String::new()
        } else {
            format!(" ({detail})")
        };
        return Err(AppError::Other(format!(
            "Piper unavailable: synthesis failed with status {status}{suffix}."
        )));
    }
    // `stderr` is intentionally dropped on the success path (already drained).
    drop(stderr);

    // Defend against a "success" exit that produced nothing (e.g. wrong model
    // type). Without this the caller would cache an empty file and the UI
    // would play silence with no clue why.
    if !out_path.is_file() {
        return Err(AppError::Other(
            "Piper unavailable: process exited cleanly but produced no audio file.".to_string(),
        ));
    }

    Ok(())
}
