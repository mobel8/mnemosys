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
//! P052 — naïve byte concat is *not* safe when a segment carries container
//! metadata. `gpt-4o-mini-tts` responses may begin with an ID3v2 tag and/or a
//! Xing/Info VBR header frame; those bytes are not audio. A single such block
//! at the very start of the file is harmless (players parse it), but the same
//! block injected mid-stream — once per joined segment — confuses the decoder:
//! it throws off the computed duration and shows up as clicks / bad seeks. So
//! we strip leading ID3v2 tags and Xing/Info frames from every segment *after
//! the first*, and drop a trailing ID3v1 tag from every segment that isn't the
//! last. The first segment is emitted verbatim so any legitimate stream header
//! it owns is preserved. The proper long-term fix is an `ffmpeg` sidecar
//! `concat`; this keeps the dependency surface at zero meanwhile.
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

    // Synthesise every line first, keeping each segment intact, so the cleanup
    // pass below can reason about first/last position (P052: a Xing header is
    // only legal on the very first segment, a trailing ID3v1 only on the last).
    let mut segments: Vec<Vec<u8>> = Vec::with_capacity(lines.len());

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
        segments.push(bytes);
    }

    let assembled = concat_mp3_segments(&segments);

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

/// P052 — stitch raw MP3 segments into one continuous stream, dropping the
/// non-audio container metadata that would otherwise land mid-file.
///
/// Rules:
/// - The **first** segment is copied verbatim, so any legitimate ID3v2 tag or
///   Xing/Info VBR header at the start of the output is preserved.
/// - Every **later** segment has its leading ID3v2 tag stripped and, if the
///   first audio frame is a Xing/Info frame, that frame dropped too — a VBR
///   header belongs only at the very start of a stream.
/// - Every segment that is **not last** has a trailing 128-byte ID3v1 tag
///   removed so it can't sit between two audio runs.
fn concat_mp3_segments(segments: &[Vec<u8>]) -> Vec<u8> {
    let total: usize = segments.iter().map(Vec::len).sum();
    let mut out = Vec::with_capacity(total);
    let last_idx = segments.len().saturating_sub(1);

    for (i, seg) in segments.iter().enumerate() {
        let is_first = i == 0;
        let is_last = i == last_idx;

        // Leading container metadata is only safe at the very start of the file.
        let body: &[u8] = if is_first {
            seg
        } else {
            let no_id3 = strip_leading_id3v2(seg);
            skip_leading_xing_info(no_id3)
        };

        // A trailing ID3v1 must never sit between two audio runs.
        let body = if is_last {
            body
        } else {
            strip_trailing_id3v1(body)
        };

        out.extend_from_slice(body);
    }

    out
}

/// Return `data` with a leading ID3v2 tag removed, or `data` unchanged when no
/// such tag is present.
///
/// ID3v2 header (10 bytes): `"ID3"`, two version bytes, one flags byte, then a
/// 4-byte *syncsafe* size (each byte holds 7 bits, MSB always 0). The size
/// excludes the 10-byte header and the optional 10-byte footer (flags bit 0x10).
fn strip_leading_id3v2(data: &[u8]) -> &[u8] {
    if data.len() < 10 || &data[0..3] != b"ID3" {
        return data;
    }
    // Reject a malformed syncsafe size (any high bit set) — treat as no tag so
    // we never slice into real audio on a false positive.
    let size_bytes = &data[6..10];
    if size_bytes.iter().any(|&b| b & 0x80 != 0) {
        return data;
    }
    let tag_size = ((size_bytes[0] as usize) << 21)
        | ((size_bytes[1] as usize) << 14)
        | ((size_bytes[2] as usize) << 7)
        | (size_bytes[3] as usize);
    let has_footer = data[5] & 0x10 != 0;
    let total = 10 + tag_size + if has_footer { 10 } else { 0 };
    if total <= data.len() {
        &data[total..]
    } else {
        // Truncated/garbage tag — leave the segment untouched rather than drop
        // everything.
        data
    }
}

/// Return `data` with a leading Xing/Info VBR header frame skipped, or `data`
/// unchanged when the first frame is ordinary audio.
///
/// A Xing/Info frame is a normal MPEG audio frame whose payload (after the
/// 4-byte frame header and the MPEG-1 mono side-info gap) starts with the tag
/// `"Xing"` or `"Info"`. It carries VBR seek data and a frame count; duplicated
/// mid-stream it corrupts the player's duration estimate. We only ever skip a
/// *single* leading such frame.
fn skip_leading_xing_info(data: &[u8]) -> &[u8] {
    if data.len() < 4 || data[0] != 0xFF || (data[1] & 0xE0) != 0xE0 {
        return data; // not at a frame boundary
    }
    let Some(frame_len) = mp3_frame_len(&data[0..4]) else {
        return data;
    };
    if frame_len < 4 || frame_len > data.len() {
        return data;
    }
    // The Xing/Info tag sits at a header-dependent offset. Rather than recompute
    // the exact side-info gap, scan the frame body for the tag near its start;
    // a genuine Xing frame places it within the first ~40 bytes.
    let scan_end = frame_len.min(40);
    let body = &data[4..scan_end];
    let is_vbr_header = body
        .windows(4)
        .any(|w| w == b"Xing" || w == b"Info");
    if is_vbr_header {
        &data[frame_len..]
    } else {
        data
    }
}

/// Compute the byte length of an MPEG-1/2 Layer III audio frame from its 4-byte
/// header, or `None` if the header fields are reserved/invalid.
///
/// `len = floor(144 * bitrate / sample_rate) + padding` for Layer III. Only the
/// MPEG-1 / MPEG-2 Layer III bitrate and sample-rate tables we can actually be
/// handed by OpenAI (24 kHz output) are covered; anything else returns `None`
/// so the caller leaves the data untouched.
fn mp3_frame_len(header: &[u8]) -> Option<usize> {
    if header.len() < 4 {
        return None;
    }
    // Version: bits 19-20. 0b11 = MPEG-1, 0b10 = MPEG-2, 0b00 = MPEG-2.5.
    let version_id = (header[1] >> 3) & 0x03;
    // Layer: bits 17-18. 0b01 = Layer III.
    let layer = (header[1] >> 1) & 0x03;
    if layer != 0b01 {
        return None; // only Layer III
    }
    let bitrate_idx = (header[2] >> 4) & 0x0F;
    let samplerate_idx = (header[2] >> 2) & 0x03;
    let padding = ((header[2] >> 1) & 0x01) as usize;
    if bitrate_idx == 0 || bitrate_idx == 0x0F || samplerate_idx == 0x03 {
        return None; // free/bad bitrate or reserved sample rate
    }

    // Layer III bitrate tables (kbps). Index 0 is "free", handled above.
    const V1_L3: [u32; 16] = [
        0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0,
    ];
    const V2_L3: [u32; 16] = [
        0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0,
    ];
    // Sample-rate tables (Hz) by version.
    const SR_V1: [u32; 3] = [44100, 48000, 32000];
    const SR_V2: [u32; 3] = [22050, 24000, 16000];
    const SR_V25: [u32; 3] = [11025, 12000, 8000];

    let is_mpeg1 = version_id == 0b11;
    let bitrate = if is_mpeg1 {
        V1_L3[bitrate_idx as usize]
    } else {
        V2_L3[bitrate_idx as usize]
    };
    let sample_rate = match version_id {
        0b11 => SR_V1[samplerate_idx as usize],
        0b10 => SR_V2[samplerate_idx as usize],
        0b00 => SR_V25[samplerate_idx as usize],
        _ => return None,
    };
    if bitrate == 0 || sample_rate == 0 {
        return None;
    }

    // Samples-per-frame differ: MPEG-1 L3 = 1152, MPEG-2/2.5 L3 = 576.
    let coeff = if is_mpeg1 { 144 } else { 72 };
    let len = (coeff * bitrate * 1000 / sample_rate) as usize + padding;
    Some(len)
}

/// Return `data` with a trailing 128-byte ID3v1 tag removed, or `data`
/// unchanged when absent. An ID3v1 tag is exactly the last 128 bytes beginning
/// with the literal `"TAG"`.
fn strip_trailing_id3v1(data: &[u8]) -> &[u8] {
    if data.len() >= 128 && &data[data.len() - 128..data.len() - 125] == b"TAG" {
        &data[..data.len() - 128]
    } else {
        data
    }
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

    // -----------------------------------------------------------------------
    // P052 — MP3 segment cleanup
    // -----------------------------------------------------------------------

    /// Build a minimal ID3v2.3 tag of `payload_len` bytes (no footer). Header
    /// is `"ID3"`, version 0x03 0x00, flags 0x00, then a 4-byte syncsafe size.
    fn id3v2(payload_len: usize) -> Vec<u8> {
        let mut v = vec![b'I', b'D', b'3', 0x03, 0x00, 0x00];
        let s = payload_len as u32;
        v.push(((s >> 21) & 0x7F) as u8);
        v.push(((s >> 14) & 0x7F) as u8);
        v.push(((s >> 7) & 0x7F) as u8);
        v.push((s & 0x7F) as u8);
        v.extend(std::iter::repeat(0u8).take(payload_len));
        v
    }

    #[test]
    fn strip_id3v2_removes_leading_tag() {
        let mut data = id3v2(5);
        data.extend_from_slice(b"AUDIO");
        assert_eq!(strip_leading_id3v2(&data), b"AUDIO");
    }

    #[test]
    fn strip_id3v2_leaves_audio_without_tag() {
        let data = b"\xFF\xFBplain audio".to_vec();
        assert_eq!(strip_leading_id3v2(&data), &data[..]);
    }

    #[test]
    fn strip_id3v2_ignores_bogus_syncsafe_size() {
        // High bit set in a size byte is illegal → treat as no tag, don't slice.
        let data = vec![b'I', b'D', b'3', 0x03, 0x00, 0x00, 0xFF, 0x00, 0x00, 0x00, 0xAA];
        assert_eq!(strip_leading_id3v2(&data), &data[..]);
    }

    #[test]
    fn strip_trailing_id3v1_removes_tag() {
        let mut data = b"realaudio".to_vec();
        let mut tag = vec![b'T', b'A', b'G'];
        tag.extend(std::iter::repeat(0u8).take(125));
        data.extend_from_slice(&tag);
        assert_eq!(strip_trailing_id3v1(&data), b"realaudio");
    }

    #[test]
    fn strip_trailing_id3v1_leaves_audio_without_tag() {
        let data = vec![0xABu8; 200];
        assert_eq!(strip_trailing_id3v1(&data), &data[..]);
    }

    #[test]
    fn concat_keeps_first_segment_metadata_strips_rest() {
        // First segment carries an ID3v2 tag (kept); the second carries one too
        // (must be stripped) plus trailing audio.
        let mut first = id3v2(3);
        first.extend_from_slice(b"\xFF\xFBAA");
        let mut second = id3v2(2);
        second.extend_from_slice(b"\xFF\xFBBB");

        let out = concat_mp3_segments(&[first.clone(), second]);
        // First segment is verbatim, including its ID3 tag.
        assert!(out.starts_with(&first));
        // The second segment's ID3 tag must NOT appear after the first's audio.
        let tail = &out[first.len()..];
        assert_eq!(tail, b"\xFF\xFBBB");
    }

    #[test]
    fn concat_single_segment_is_verbatim() {
        let only = id3v2(4);
        let out = concat_mp3_segments(&[only.clone()]);
        assert_eq!(out, only);
    }
}
