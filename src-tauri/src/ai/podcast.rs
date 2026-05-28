//! Podcast script generation (Vague 8 — Deck Podcast / NotebookLM-style).
//!
//! Given a deck's cards, ask Claude to write a 2-voice dialogue between a
//! curious Host and an expert Expert that walks the learner through the
//! material as if it were a short podcast episode. The result is a vector of
//! [`PodcastLine`] records — speaker tag + text — that the TTS pipeline
//! ([`crate::tts::podcast`]) then turns into a concatenated MP3.
//!
//! Three formats steer the tone:
//! - `DeepDive`  — detailed, long-form explanations (~5 min, all cards).
//! - `Brief`     — fast-paced summary highlight reel (~2 min).
//! - `Critique`  — adversarial, the Expert challenges the Host on assumptions.
//!
//! The module is intentionally side-effect free: no DB, no settings — the
//! command layer ([`crate::commands::podcast`]) gathers cards and resolves
//! API keys.

use serde::{Deserialize, Serialize};

use super::claude::{ClaudeClient, ClaudeError};

/// One line of dialogue: which voice should speak, and what they say.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PodcastLine {
    /// Either `"host"` or `"expert"`. Validated server-side before TTS.
    pub speaker: String,
    /// The line to read out loud. Already in the requested language.
    pub text: String,
}

/// Tone preset driving the prompt's flavour. Serialised as snake_case so the
/// IPC layer (and on-disk cache filenames) match the JSON the frontend sends.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PodcastFormat {
    DeepDive,
    Brief,
    Critique,
}

impl PodcastFormat {
    /// Human-readable slug used in the prompt + the cache key.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::DeepDive => "deep_dive",
            Self::Brief => "brief",
            Self::Critique => "critique",
        }
    }

    /// Targeted line count for the dialogue — ~30 for a 5-min Deep Dive,
    /// shorter for Brief, similar to DeepDive for the Critique (the
    /// adversarial back-and-forth needs room to breathe).
    fn target_lines(self) -> u32 {
        match self {
            Self::DeepDive => 30,
            Self::Brief => 14,
            Self::Critique => 28,
        }
    }
}

/// 8k tokens fits 30 dialogue lines comfortably — each line is ~30-60 tokens.
const MAX_OUTPUT_TOKENS: u32 = 8_000;

/// Generate a podcast script from the deck content.
///
/// `cards` is a vector of `(front, back)` pairs (or `(text, "")` for cloze
/// cards) the caller has already extracted. `deck_name` lets the Host hook
/// the episode (« Today we're diving into {deck_name}… »).
pub async fn generate_podcast_script(
    client: &ClaudeClient,
    deck_name: &str,
    cards: &[(String, String)],
    format: PodcastFormat,
    language: &str,
) -> Result<Vec<PodcastLine>, ClaudeError> {
    if cards.is_empty() {
        return Err(ClaudeError::InvalidResponse(
            "no cards supplied to script generator".to_string(),
        ));
    }

    let target = format.target_lines();
    let format_hint = match format {
        PodcastFormat::DeepDive => {
            "Style: a thorough deep-dive episode. The Expert explains each concept in 2-3 \
             sentences with concrete examples; the Host asks curious follow-up questions. \
             Cover every card, but interweave them so the conversation flows naturally."
        }
        PodcastFormat::Brief => {
            "Style: a tight 2-minute highlight reel. Cover only the most important cards \
             (pick ~half of them). The Expert keeps answers short (1 sentence each); the \
             Host moves fast and crisp."
        }
        PodcastFormat::Critique => {
            "Style: a critical-thinking episode. The Host plays devil's advocate, \
             challenging every claim. The Expert defends with evidence and admits limits. \
             Cover every card, but turn each into a mini debate."
        }
    };

    let system_prompt = format!(
        r#"You are a pedagogical scriptwriter producing a 2-voice podcast dialogue between:
- "host"   — curious learner, asks questions, occasionally summarises.
- "expert" — domain expert ("Experte"), explains clearly without jargon.

Rules:
1. Output a SINGLE JSON array — NO markdown fences, NO preamble, NO trailing prose.
2. Each element has exactly two keys: "speaker" (either "host" or "expert") and "text".
3. Lines must alternate roughly; never have 3 lines in a row from the same speaker.
4. Open with the Host welcoming the listener and naming the deck.
5. Close with a 1-line wrap-up by the Host.
6. Aim for ~{target} lines total.
7. {format_hint}
8. Stay in the requested language. Use natural spoken phrasing — contractions, fillers like "right?" sparingly.
9. NEVER invent facts beyond what's grounded in the supplied cards.

Example output (and ONLY this kind of output):
[
  {{"speaker":"host","text":"Welcome back! Today we're unpacking the {{deck name}} deck."}},
  {{"speaker":"expert","text":"Great topic — let's start with..."}},
  ...
]
"#,
        target = target,
        format_hint = format_hint,
    );

    // Compact deck excerpt — keep the payload modest so a big deck still fits.
    let mut excerpt = String::new();
    for (i, (front, back)) in cards.iter().enumerate() {
        excerpt.push_str(&format!("{}. ", i + 1));
        excerpt.push_str(front.trim());
        if !back.trim().is_empty() {
            excerpt.push_str(" — ");
            excerpt.push_str(back.trim());
        }
        excerpt.push('\n');
    }

    let prompt = format!(
        "Deck name: {deck_name}\nOutput language: {language}\n\n\
         Cards:\n{excerpt}\n\
         Return ONLY the JSON array of dialogue lines."
    );

    let response = client
        .complete(Some(&system_prompt), &prompt, MAX_OUTPUT_TOKENS)
        .await?;

    parse_script_response(&response)
}

/// Strip markdown fences if present and parse the JSON array.
pub(super) fn parse_script_response(response: &str) -> Result<Vec<PodcastLine>, ClaudeError> {
    let cleaned = strip_code_fences(response.trim());

    let lines: Vec<PodcastLine> = serde_json::from_str(cleaned).map_err(|e| {
        let preview: String = response.chars().take(200).collect();
        ClaudeError::InvalidResponse(format!(
            "Podcast script JSON parse error: {} (got: {})",
            e, preview
        ))
    })?;

    // Drop any lines whose speaker tag is unknown so the TTS layer doesn't
    // need to worry about junk values. Empty-text lines are also filtered —
    // OpenAI TTS rejects them and they'd produce a 0-byte MP3 anyway.
    let cleaned: Vec<PodcastLine> = lines
        .into_iter()
        .filter(|l| (l.speaker == "host" || l.speaker == "expert") && !l.text.trim().is_empty())
        .collect();

    if cleaned.is_empty() {
        return Err(ClaudeError::InvalidResponse(
            "podcast script contained no valid lines".to_string(),
        ));
    }

    Ok(cleaned)
}

fn strip_code_fences(s: &str) -> &str {
    let mut out = s.trim();
    if let Some(rest) = out.strip_prefix("```") {
        let rest = match rest.find('\n') {
            Some(nl) => &rest[nl + 1..],
            None => rest,
        };
        out = rest.trim_end();
    }
    if let Some(stripped) = out.strip_suffix("```") {
        out = stripped.trim_end();
    }
    out.trim()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_clean_script_json() {
        let raw = r#"[
            {"speaker":"host","text":"Welcome!"},
            {"speaker":"expert","text":"Hi there."}
        ]"#;
        let lines = parse_script_response(raw).expect("parse");
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].speaker, "host");
        assert_eq!(lines[1].speaker, "expert");
    }

    #[test]
    fn parses_script_with_fences() {
        let raw = "```json\n[{\"speaker\":\"host\",\"text\":\"hi\"}]\n```";
        let lines = parse_script_response(raw).expect("parse fenced");
        assert_eq!(lines.len(), 1);
    }

    #[test]
    fn drops_unknown_speaker_tags() {
        let raw = r#"[
            {"speaker":"narrator","text":"junk"},
            {"speaker":"host","text":"kept"}
        ]"#;
        let lines = parse_script_response(raw).expect("parse");
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].speaker, "host");
    }

    #[test]
    fn drops_empty_text_lines() {
        let raw = r#"[
            {"speaker":"host","text":"   "},
            {"speaker":"expert","text":"actual content"}
        ]"#;
        let lines = parse_script_response(raw).expect("parse");
        assert_eq!(lines.len(), 1);
    }

    #[test]
    fn rejects_when_no_valid_lines_remain() {
        let raw = r#"[{"speaker":"narrator","text":"junk"}]"#;
        assert!(parse_script_response(raw).is_err());
    }

    #[test]
    fn rejects_malformed_json() {
        assert!(parse_script_response("not json").is_err());
    }

    #[test]
    fn format_slugs_are_stable() {
        assert_eq!(PodcastFormat::DeepDive.as_str(), "deep_dive");
        assert_eq!(PodcastFormat::Brief.as_str(), "brief");
        assert_eq!(PodcastFormat::Critique.as_str(), "critique");
    }
}
