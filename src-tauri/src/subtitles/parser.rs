//! Low-level subtitle parser for `.srt` (SubRip) and `.vtt` (WebVTT).
//!
//! The two formats share a cue structure — an index/identifier, a timing line
//! (`START --> END`), and one or more text lines — so a single state machine
//! handles both. The only meaningful differences:
//!
//! - SRT uses a comma as the millisecond separator (`00:00:01,000`); VTT uses
//!   a dot (`00:00:01.000`). We normalise the comma to a dot before parsing.
//! - VTT opens with a `WEBVTT` signature line and may carry `NOTE`, `STYLE`
//!   and `REGION` blocks plus cue settings after the timing (`align:start`).
//!   Those are recognised and skipped.
//!
//! Output is a `Vec<SubtitleCue>` with inline formatting stripped (`<i>`,
//! `<b>`, `<font …>`, SSA/ASS `{…}` overrides) and multi-line cue text merged
//! with a single space. Purely a data transform — no I/O.

use serde::Serialize;

/// A single parsed subtitle cue. Times are in milliseconds from the start of
/// the media. `index` is the cue's 1-based position in the file (SRT numbers
/// them explicitly; for VTT we assign sequentially), not the file's own id.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SubtitleCue {
    pub index: usize,
    pub start_ms: i64,
    pub end_ms: i64,
    pub text: String,
}

/// Parse a subtitle document. The `is_vtt` hint only affects how leniently we
/// treat header/metadata blocks; timing parsing auto-detects `,` vs `.`, so a
/// mis-flagged file still parses its cues. Cues with empty text after
/// stripping are dropped here (the importer also filters music/♪ lines).
pub fn parse(content: &str, is_vtt: bool) -> Vec<SubtitleCue> {
    // Strip a leading UTF-8 BOM and normalise CRLF / lone CR to LF so the
    // line splitter below sees a single newline convention.
    let normalised = content
        .trim_start_matches('\u{feff}')
        .replace("\r\n", "\n")
        .replace('\r', "\n");

    let mut cues = Vec::new();
    let mut next_index = 1usize;

    // Blocks are separated by one or more blank lines. We further split on
    // the timing arrow inside a block rather than trusting the index line,
    // which makes the parser tolerant of missing/garbage index numbers.
    for block in normalised.split("\n\n") {
        let block = block.trim_matches('\n');
        if block.is_empty() {
            continue;
        }

        let mut lines = block.lines().peekable();

        // VTT-only header / metadata blocks we must ignore entirely.
        if is_vtt {
            if let Some(first) = lines.peek() {
                let head = first.trim();
                if head.starts_with("WEBVTT")
                    || head.starts_with("NOTE")
                    || head.starts_with("STYLE")
                    || head.starts_with("REGION")
                {
                    continue;
                }
            }
        }

        // Find the timing line within the block. Everything before it is an
        // optional index / cue identifier; everything after is cue text.
        let mut timing: Option<(i64, i64)> = None;
        let mut text_lines: Vec<&str> = Vec::new();
        for line in lines {
            if timing.is_none() {
                if let Some(parsed) = parse_timing_line(line) {
                    timing = Some(parsed);
                    continue;
                }
                // Not the timing line yet — this is the index/id line, skip it.
                continue;
            }
            text_lines.push(line);
        }

        let Some((start_ms, end_ms)) = timing else {
            continue;
        };

        let merged = text_lines.join(" ");
        let cleaned = strip_formatting(&merged);
        let cleaned = cleaned.trim();
        if cleaned.is_empty() {
            continue;
        }

        cues.push(SubtitleCue {
            index: next_index,
            start_ms,
            end_ms,
            text: cleaned.to_string(),
        });
        next_index += 1;
    }

    cues
}

/// Parse a `START --> END` timing line into `(start_ms, end_ms)`.
///
/// Accepts both SRT (`00:00:01,000`) and VTT (`00:00:01.000`) separators and
/// the VTT short form (`01:02.000` — minutes:seconds without an hour field).
/// Any trailing cue settings after the end time (VTT `align:start position:…`)
/// are ignored. Returns `None` for non-timing lines.
fn parse_timing_line(line: &str) -> Option<(i64, i64)> {
    let line = line.trim();
    let arrow = line.find("-->")?;
    let (left, right) = line.split_at(arrow);
    let right = &right[3..]; // skip "-->"

    // The end side may carry space-separated cue settings (VTT). Keep only
    // the first whitespace-delimited token as the timestamp.
    let end_token = right.split_whitespace().next().unwrap_or("");
    let start = parse_timestamp(left.trim())?;
    let end = parse_timestamp(end_token)?;
    Some((start, end))
}

/// Parse a single `HH:MM:SS,mmm` / `HH:MM:SS.mmm` / `MM:SS.mmm` timestamp into
/// milliseconds. Returns `None` if the shape doesn't match.
fn parse_timestamp(ts: &str) -> Option<i64> {
    let ts = ts.replace(',', ".");
    let (clock, millis) = match ts.split_once('.') {
        Some((c, m)) => (c, m),
        None => (ts.as_str(), "0"),
    };

    let mut parts = clock.split(':').rev();
    let seconds: i64 = parts.next()?.parse().ok()?;
    let minutes: i64 = parts.next()?.parse().ok()?;
    // Hours are optional (VTT short form omits them).
    let hours: i64 = match parts.next() {
        Some(h) => h.parse().ok()?,
        None => 0,
    };
    // Reject anything with extra ':' groups beyond HH:MM:SS.
    if parts.next().is_some() {
        return None;
    }

    // Millisecond field: pad/truncate to exactly 3 digits so `.5` → 500ms.
    let millis_digits: String = millis.chars().filter(|c| c.is_ascii_digit()).collect();
    if millis_digits.is_empty() && !millis.is_empty() {
        // The fractional part contained non-digits only — malformed.
        return None;
    }
    let millis_val: i64 = format!("{:0<3}", &millis_digits[..millis_digits.len().min(3)])
        .parse()
        .ok()?;

    Some(((hours * 3600 + minutes * 60 + seconds) * 1000) + millis_val)
}

/// Strip inline subtitle formatting from a line.
///
/// Removes:
/// - HTML/VTT angle-bracket tags: `<i>`, `</i>`, `<b>`, `<font color="…">`,
///   `<c.classname>`, `<00:00:01.000>` (VTT inline timestamps), …
/// - SSA/ASS curly-brace override blocks: `{\an8}`, `{…}`.
///
/// We hand-roll the scan to avoid pulling `regex` into the binary. Collapses
/// the runs of whitespace that stripping can leave behind.
pub fn strip_formatting(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();

    while let Some(c) = chars.next() {
        match c {
            '<' => {
                // Drop everything up to and including the next '>'.
                for inner in chars.by_ref() {
                    if inner == '>' {
                        break;
                    }
                }
            }
            '{' => {
                // Drop SSA/ASS override blocks up to the matching '}'.
                for inner in chars.by_ref() {
                    if inner == '}' {
                        break;
                    }
                }
            }
            other => out.push(other),
        }
    }

    // Collapse whitespace runs (a stripped `<i>` between words can double a
    // space) and trim. Splitting on Unicode whitespace also folds tabs.
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}
