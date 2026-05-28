//! Podcast audio assembly (Vague 8).
//!
//! Synthesise each [`PodcastLine`] with the appropriate voice and concatenate
//! the resulting MP3 byte streams into one file.
//!
//! Why byte-level concat?
//! ----------------------
//! OpenAI TTS always returns MP3 at the same sample rate (24 kHz) and bitrate
//! per voice, so frame headers are compatible across segments. Joining the
//! raw byte streams in order produces a playable MP3 — players just keep
//! reading frames. There may be a tiny audible gap at each boundary, which
//! is acceptable for an MVP. A future version can pipe through `ffmpeg`
//! sidecar to crossfade segments cleanly.
//!
//! This module is intentionally side-effect free aside from the file write
//! at the very end — the command layer ([`crate::commands::podcast`]) owns
//! path resolution and error mapping.

use std::path::Path;

use crate::ai::podcast::PodcastLine;
use crate::error::{AppError, AppResult};
use crate::tts::openai::{OpenAIClient, Voice};

/// Synthesise the whole script and write a single MP3 to `output_path`.
///
/// `host_voice` plays every `speaker == "host"` line; `expert_voice` plays
/// every `speaker == "expert"` line. Lines whose speaker tag is anything
/// else are silently skipped — the script parser already filtered those, so
/// hitting this path means caller-side bypass.
///
/// Returns the total byte size of the assembled MP3 (useful for stats).
pub async fn synthesize_podcast(
    client: &OpenAIClient,
    lines: &[PodcastLine],
    host_voice: Voice,
    expert_voice: Voice,
    speed: f32,
    output_path: &Path,
) -> AppResult<usize> {
    if lines.is_empty() {
        return Err(AppError::Validation(
            "cannot synthesise an empty podcast script".to_string(),
        ));
    }

    let mut assembled: Vec<u8> = Vec::with_capacity(lines.len() * 32 * 1024);

    for line in lines {
        let voice = match line.speaker.as_str() {
            "host" => host_voice,
            "expert" => expert_voice,
            // Defensive — the parser already drops these but keep the match
            // exhaustive so a regression surfaces here, not as silent skips.
            other => {
                log::warn!("podcast: skipping line with unknown speaker '{}'", other);
                continue;
            }
        };

        let bytes = client
            .synthesize(&line.text, voice, speed)
            .await
            .map_err(|e| AppError::Other(format!("TTS line failed: {e}")))?;
        assembled.extend_from_slice(&bytes);
    }

    if assembled.is_empty() {
        return Err(AppError::Other(
            "podcast synthesis produced 0 bytes".to_string(),
        ));
    }

    // Ensure the parent directory exists before writing. `cache_dir()` already
    // does this for the caller but we hedge in case the directory was wiped
    // mid-flight.
    if let Some(parent) = output_path.parent() {
        std::fs::create_dir_all(parent).map_err(AppError::from)?;
    }
    std::fs::write(output_path, &assembled).map_err(AppError::from)?;
    Ok(assembled.len())
}

/// Approximate playback duration of a script.
///
/// Heuristic: ~150 words per minute is the upper bound for English / French
/// natural speech, so we count words and convert to seconds. Used only for a
/// UI label ("≈4 min") so a 20% error is fine.
pub fn estimate_duration_seconds(lines: &[PodcastLine]) -> u32 {
    let word_count: usize = lines
        .iter()
        .map(|l| l.text.split_whitespace().count())
        .sum();
    // 150 wpm → 2.5 wps → seconds = words / 2.5.
    let seconds = (word_count as f64 / 2.5).round();
    seconds.max(1.0) as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mk(speaker: &str, text: &str) -> PodcastLine {
        PodcastLine {
            speaker: speaker.into(),
            text: text.into(),
        }
    }

    #[test]
    fn estimates_short_script_duration() {
        let lines = vec![mk("host", "one two three four five")];
        // 5 words / 2.5 ≈ 2s
        assert_eq!(estimate_duration_seconds(&lines), 2);
    }

    #[test]
    fn estimates_duration_for_multiple_lines() {
        // 25 words total → 10s
        let lines = vec![
            mk("host", "a b c d e f g h i j"),
            mk("expert", "k l m n o p q r s t u v w x y"),
        ];
        assert_eq!(estimate_duration_seconds(&lines), 10);
    }

    #[test]
    fn duration_never_zero() {
        let lines = vec![mk("host", "")];
        assert_eq!(estimate_duration_seconds(&lines), 1);
    }
}
