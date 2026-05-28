//! Tauri command surface for the Deck Podcast feature (Vague 8).
//!
//! Three commands:
//! - [`generate_deck_podcast`] — Claude → script, OpenAI TTS → 2-voice MP3.
//! - [`list_deck_podcasts`]    — enumerate previously generated MP3s.
//! - [`delete_podcast`]        — wipe a generated MP3 (path is validated to
//!   live under the cache dir).
//!
//! Files live under `<app_cache_dir>/podcasts/deck-<deck_id>-<hash>.mp3` so
//! identical (deck, format, voices, card-set) requests are a fast file lookup
//! while different decks stay neatly separated.

use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::ai::podcast::{generate_podcast_script, PodcastFormat};
use crate::ai::ClaudeClient;
use crate::app_state::AppState;
use crate::error::{AppError, AppResult};
use crate::tts::podcast::{estimate_duration_seconds, synthesize_podcast};
use crate::tts::{OpenAIClient, Voice};

// Cap how many cards we feed Claude per podcast. 30 keeps the prompt small
// AND matches the upper bound the prompt itself targets.
const MAX_CARDS_PER_PODCAST: usize = 30;

/// Frontend-visible result of [`generate_deck_podcast`].
#[derive(Debug, Serialize)]
pub struct PodcastResult {
    /// Absolute MP3 path on disk. Feed into `convertFileSrc()` to play in the UI.
    pub path: String,
    /// Cheap heuristic — `total_words / 2.5` rounded to seconds.
    pub duration_estimate_seconds: u32,
    /// Number of dialogue lines actually synthesised.
    pub line_count: u32,
    /// `true` when the file was served from the on-disk cache (no API calls made).
    pub cached: bool,
    /// Final file size in bytes.
    pub size_bytes: u64,
}

/// One row in [`list_deck_podcasts`]. Plain enough that the UI can render
/// it without further IPC.
#[derive(Debug, Serialize)]
pub struct PodcastFile {
    pub path: String,
    /// Unix-seconds modification time (i.e. when the file was generated).
    pub generated_at: i64,
    pub size_bytes: u64,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn podcasts_dir(app: &AppHandle) -> AppResult<PathBuf> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| AppError::Other(format!("resolve app_cache_dir: {e}")))?
        .join("podcasts");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

fn parse_voice(slug: &str) -> AppResult<Voice> {
    Ok(match slug {
        "alloy" => Voice::Alloy,
        "echo" => Voice::Echo,
        "fable" => Voice::Fable,
        "onyx" => Voice::Onyx,
        "nova" => Voice::Nova,
        "shimmer" => Voice::Shimmer,
        "coral" => Voice::Coral,
        "sage" => Voice::Sage,
        other => {
            return Err(AppError::Validation(format!(
                "Unknown voice: {other}. Supported: alloy, echo, fable, onyx, nova, shimmer, coral, sage"
            )));
        }
    })
}

fn parse_format(slug: &str) -> AppResult<PodcastFormat> {
    Ok(match slug {
        "deep_dive" => PodcastFormat::DeepDive,
        "brief" => PodcastFormat::Brief,
        "critique" => PodcastFormat::Critique,
        other => {
            return Err(AppError::Validation(format!(
                "Unknown podcast format: {other}. Supported: deep_dive, brief, critique"
            )));
        }
    })
}

fn resolve_anthropic_key(app: &AppHandle) -> AppResult<String> {
    if let Ok(key) = std::env::var("ANTHROPIC_API_KEY") {
        if !key.trim().is_empty() {
            return Ok(key);
        }
    }

    use tauri_plugin_store::StoreExt;
    let store = app
        .store("settings.json")
        .map_err(|e| AppError::Other(format!("open settings store: {e}")))?;
    if let Some(value) = store.get("app_settings") {
        if let Some(key) = value
            .get("anthropic_api_key")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            return Ok(key.to_string());
        }
    }

    Err(AppError::Validation(
        "Anthropic API key not configured. Set ANTHROPIC_API_KEY env var or configure it in Settings."
            .to_string(),
    ))
}

fn resolve_openai_key(app: &AppHandle) -> AppResult<String> {
    if let Ok(key) = std::env::var("OPENAI_API_KEY") {
        if !key.is_empty() {
            return Ok(key);
        }
    }

    use tauri_plugin_store::StoreExt;
    let store = app
        .store("settings.json")
        .map_err(|e| AppError::Other(format!("open settings store: {e}")))?;
    if let Some(value) = store.get("app_settings") {
        if let Some(key) = value
            .get("openai_api_key")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
        {
            return Ok(key.to_string());
        }
    }

    Err(AppError::Validation(
        "OpenAI API key not configured. Set OPENAI_API_KEY env var or configure it in Settings."
            .to_string(),
    ))
}

/// Pull up to `MAX_CARDS_PER_PODCAST` `(front, back)` tuples for the deck.
/// Skips `occlusion` notes (no useful text content for podcasting).
fn fetch_deck_cards(state: &AppState, deck_id: i64) -> AppResult<(String, Vec<(String, String)>)> {
    let conn = state.db.lock();

    let deck_name: String = conn
        .query_row(
            "SELECT name FROM decks WHERE id = ?1",
            rusqlite::params![deck_id],
            |row| row.get::<_, String>(0),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("deck {deck_id}")),
            other => AppError::Database(other.to_string()),
        })?;

    let mut stmt = conn.prepare(
        "SELECT fields FROM notes
         WHERE deck_id = ?1 AND template <> 'occlusion'
         ORDER BY id ASC
         LIMIT ?2",
    )?;
    let limit = MAX_CARDS_PER_PODCAST as i64;
    let rows = stmt.query_map(rusqlite::params![deck_id, limit], |r| r.get::<_, String>(0))?;

    let mut cards = Vec::new();
    for row in rows {
        let fields_json = match row {
            Ok(s) => s,
            Err(_) => continue,
        };
        let value: serde_json::Value = match serde_json::from_str(&fields_json) {
            Ok(v) => v,
            Err(_) => continue,
        };

        // Basic / basic_reverse: { front, back }
        if let (Some(front), Some(back)) = (
            value.get("front").and_then(|v| v.as_str()),
            value.get("back").and_then(|v| v.as_str()),
        ) {
            let f = front.trim();
            let b = back.trim();
            if !f.is_empty() {
                cards.push((f.to_string(), b.to_string()));
                continue;
            }
        }
        // Cloze: { text }
        if let Some(text) = value.get("text").and_then(|v| v.as_str()) {
            let t = text.trim();
            if !t.is_empty() {
                cards.push((t.to_string(), String::new()));
            }
        }
    }

    Ok((deck_name, cards))
}

/// Stable hash of all inputs that influence the generated MP3 — re-running
/// with the same settings is a fast disk hit.
fn podcast_filename(
    deck_id: i64,
    format: &str,
    host_voice: &str,
    expert_voice: &str,
    cards: &[(String, String)],
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(format.as_bytes());
    hasher.update(b"|");
    hasher.update(host_voice.as_bytes());
    hasher.update(b"|");
    hasher.update(expert_voice.as_bytes());
    hasher.update(b"|");
    for (f, b) in cards {
        hasher.update(f.as_bytes());
        hasher.update(b"\x1e");
        hasher.update(b.as_bytes());
        hasher.update(b"\x1f");
    }
    let digest = hasher.finalize();
    // First 16 hex chars are plenty — collision space is ~10^19.
    let short = format!("{:x}", digest);
    let short = &short[..short.len().min(16)];
    format!("deck-{deck_id}-{short}.mp3")
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Generate (or cache-hit) a 2-voice podcast MP3 for `deck_id`.
#[tauri::command]
pub async fn generate_deck_podcast(
    app: AppHandle,
    state: State<'_, AppState>,
    deck_id: i64,
    format: String,
    host_voice: String,
    expert_voice: String,
    language: Option<String>,
) -> AppResult<PodcastResult> {
    let fmt = parse_format(&format)?;
    let host = parse_voice(&host_voice)?;
    let expert = parse_voice(&expert_voice)?;
    let lang = language.unwrap_or_else(|| "fr".to_string());

    let (deck_name, cards) = fetch_deck_cards(&state, deck_id)?;
    if cards.len() < 3 {
        return Err(AppError::Validation(
            "deck must contain at least 3 cards to generate a podcast".to_string(),
        ));
    }

    let dir = podcasts_dir(&app)?;
    let filename = podcast_filename(deck_id, &format, &host_voice, &expert_voice, &cards);
    let output_path = dir.join(&filename);

    // Fast path: cached MP3 already exists.
    if output_path.exists() {
        let meta = std::fs::metadata(&output_path)?;
        return Ok(PodcastResult {
            path: output_path.to_string_lossy().into_owned(),
            // For cached files we can't recover the original line count; the UI
            // doesn't strictly need it on a cache hit, so 0 is honest. Duration
            // could be guessed from file size at the cost of new code — skip it.
            duration_estimate_seconds: 0,
            line_count: 0,
            cached: true,
            size_bytes: meta.len(),
        });
    }

    // 1. Generate the script via Claude.
    let claude_key = resolve_anthropic_key(&app)?;
    let claude = ClaudeClient::new(claude_key);
    let lines = generate_podcast_script(&claude, &deck_name, &cards, fmt, &lang)
        .await
        .map_err(|e| AppError::Other(e.to_string()))?;

    // 2. Synthesise audio with OpenAI TTS, concatenating segments.
    let openai_key = resolve_openai_key(&app)?;
    let tts = OpenAIClient::new(openai_key);
    let duration = estimate_duration_seconds(&lines);
    let line_count = lines.len() as u32;
    let bytes_written = synthesize_podcast(&tts, &lines, host, expert, 1.0, &output_path).await?;

    Ok(PodcastResult {
        path: output_path.to_string_lossy().into_owned(),
        duration_estimate_seconds: duration,
        line_count,
        cached: false,
        size_bytes: bytes_written as u64,
    })
}

/// List previously-generated podcasts for the given deck.
///
/// Only files whose name starts with `deck-<id>-` are returned, so other
/// decks' artefacts stay invisible even though they share the same directory.
#[tauri::command]
pub fn list_deck_podcasts(app: AppHandle, deck_id: i64) -> AppResult<Vec<PodcastFile>> {
    let dir = match podcasts_dir(&app) {
        Ok(d) => d,
        // Brand-new install: no dir yet.
        Err(_) => return Ok(Vec::new()),
    };
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let prefix = format!("deck-{deck_id}-");
    let mut files = Vec::new();
    for entry in std::fs::read_dir(&dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("mp3") {
            continue;
        }
        let Some(file_name) = path.file_name().and_then(|s| s.to_str()) else {
            continue;
        };
        if !file_name.starts_with(&prefix) {
            continue;
        }
        let meta = entry.metadata()?;
        // SystemTime → unix seconds. Fall back to 0 if the FS lies (rare).
        let generated_at = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        files.push(PodcastFile {
            path: path.to_string_lossy().into_owned(),
            generated_at,
            size_bytes: meta.len(),
        });
    }
    // Newest first.
    files.sort_by_key(|f| std::cmp::Reverse(f.generated_at));
    Ok(files)
}

/// Delete a single podcast MP3.
///
/// `path` MUST resolve inside the podcasts cache directory; otherwise we
/// refuse with a validation error to make sure a malicious caller can't use
/// the command as an arbitrary `unlink`.
#[tauri::command]
pub fn delete_podcast(app: AppHandle, path: String) -> AppResult<()> {
    let dir = podcasts_dir(&app)?;
    let target = Path::new(&path);
    // Canonicalise both sides so symlinks / `..` segments can't slip past.
    let canon_target = std::fs::canonicalize(target)
        .map_err(|e| AppError::Validation(format!("invalid path: {e}")))?;
    let canon_dir = std::fs::canonicalize(&dir).map_err(AppError::from)?;
    if !canon_target.starts_with(&canon_dir) {
        return Err(AppError::Validation(
            "refused to delete file outside the podcasts cache directory".to_string(),
        ));
    }
    std::fs::remove_file(&canon_target)?;
    Ok(())
}
