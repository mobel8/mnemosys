//! Mnemonic image generation via OpenAI's Images API (Vague 22).
//!
//! Extends the text-only Mnemonic Helper (Vague 13): for a card the learner
//! keeps forgetting, we ask DALL·E 3 for a single absurd, vivid picture that
//! anchors the `front → back` association (dual-coding theory — Paivio 1971:
//! a memorable image is a second retrieval route alongside the verbal trace).
//!
//! Transport choice
//! ----------------
//! We request `response_format: "b64_json"` so the PNG comes back inline in the
//! one JSON response — no second HTTP round-trip to a signed URL that could
//! expire before we fetch it, and the call stays a single awaitable. The bytes
//! are decoded and the SHA-256-addressed PNG is written to disk by the command
//! layer ([`crate::commands::ai`]); this module stays side-effect free apart
//! from the network call, mirroring the rest of [`crate::ai`].

use reqwest::Client;
use serde::{Deserialize, Serialize};

/// OpenAI image generation endpoint.
const OPENAI_IMAGES_URL: &str = "https://api.openai.com/v1/images/generations";

/// Model. `dall-e-3` is stable, supports `b64_json`, and 1024×1024 is its
/// cheapest square size — ample for a flashcard-side thumbnail.
const DEFAULT_IMAGE_MODEL: &str = "dall-e-3";

/// Square output. The smallest size DALL·E 3 offers; bigger would only inflate
/// cost and disk for a memory aid that's glanced at, not printed.
const IMAGE_SIZE: &str = "1024x1024";

/// Generous ceiling: image generation TTFB is far slower than text.
const REQUEST_TIMEOUT_SECS: u64 = 120;

/// Errors specific to the image transport. Kept distinct so the command layer
/// can surface a "configure your OpenAI key" CTA on [`ImageError::NoApiKey`].
#[derive(Debug, thiserror::Error)]
pub enum ImageError {
    #[error("OpenAI API key not configured. Set OPENAI_API_KEY env var or configure it in Settings.")]
    NoApiKey,
    #[error("HTTP error: {0}")]
    Http(String),
    #[error("OpenAI Images API returned {status}: {message}")]
    Api { status: u16, message: String },
    #[error("Invalid response from OpenAI Images API: {0}")]
    InvalidResponse(String),
}

/// On-the-wire request payload. Field names match OpenAI's spec verbatim.
#[derive(Serialize)]
struct ImageRequest<'a> {
    model: &'a str,
    prompt: &'a str,
    n: u8,
    size: &'a str,
    response_format: &'a str,
}

#[derive(Deserialize)]
struct ImageResponse {
    data: Vec<ImageDatum>,
}

#[derive(Deserialize)]
struct ImageDatum {
    /// Base64-encoded PNG (present because we ask for `b64_json`).
    #[serde(default)]
    b64_json: Option<String>,
}

/// Thin OpenAI Images client. Cheap to construct; reuse where possible since
/// the inner [`reqwest::Client`] holds a connection pool.
pub struct ImageClient {
    api_key: String,
    http: Client,
}

impl ImageClient {
    /// Build a client. Does **not** validate the key — that happens on the
    /// first [`Self::generate`] call so the constructor stays infallible.
    pub fn new(api_key: String) -> Self {
        Self {
            api_key,
            http: Client::builder()
                .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS))
                .build()
                .expect("reqwest client builder cannot fail with these options"),
        }
    }

    /// Generate one image for `prompt` and return the raw decoded PNG bytes.
    ///
    /// Empty key short-circuits before any network call. A non-2xx status
    /// surfaces the response body verbatim so the UI can show the precise
    /// reason (quota, content policy, …).
    pub async fn generate(&self, prompt: &str) -> Result<Vec<u8>, ImageError> {
        if self.api_key.trim().is_empty() {
            return Err(ImageError::NoApiKey);
        }

        let req = ImageRequest {
            model: DEFAULT_IMAGE_MODEL,
            prompt,
            n: 1,
            size: IMAGE_SIZE,
            response_format: "b64_json",
        };

        let resp = self
            .http
            .post(OPENAI_IMAGES_URL)
            .header("authorization", format!("Bearer {}", self.api_key))
            .header("content-type", "application/json")
            .json(&req)
            .send()
            .await
            .map_err(|e| ImageError::Http(e.to_string()))?;

        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(ImageError::Api {
                status: status.as_u16(),
                message: body,
            });
        }

        let parsed: ImageResponse = resp
            .json()
            .await
            .map_err(|e| ImageError::InvalidResponse(e.to_string()))?;

        let b64 = parsed
            .data
            .into_iter()
            .find_map(|d| d.b64_json)
            .ok_or_else(|| {
                ImageError::InvalidResponse("response contained no b64_json image".to_string())
            })?;

        decode_b64_png(&b64)
            .ok_or_else(|| ImageError::InvalidResponse("b64_json was not valid base64".to_string()))
    }
}

/// Decode a standard (RFC 4648, padded) base64 string into bytes.
///
/// Hand-rolled to avoid pulling in the `base64` crate just for one call (the
/// constraint for this wave is no new Cargo dependencies). Returns `None` on
/// any malformed input — an invalid character, bad length, or stray padding.
fn decode_b64_png(s: &str) -> Option<Vec<u8>> {
    // Map an alphabet byte to its 6-bit value, or `None` if it isn't part of
    // the standard base64 alphabet.
    fn val(b: u8) -> Option<u8> {
        match b {
            b'A'..=b'Z' => Some(b - b'A'),
            b'a'..=b'z' => Some(b - b'a' + 26),
            b'0'..=b'9' => Some(b - b'0' + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }

    // Strip ASCII whitespace (some encoders wrap lines); ignore nothing else.
    let bytes: Vec<u8> = s.bytes().filter(|b| !b.is_ascii_whitespace()).collect();
    if bytes.is_empty() || bytes.len() % 4 != 0 {
        return None;
    }

    let mut out = Vec::with_capacity(bytes.len() / 4 * 3);
    for chunk in bytes.chunks(4) {
        let pad = chunk.iter().filter(|&&b| b == b'=').count();
        if pad > 2 {
            return None;
        }
        // Padding may only appear at the very end of the input.
        let mut acc: u32 = 0;
        for (i, &b) in chunk.iter().enumerate() {
            let six = if b == b'=' {
                // A '=' is only legal in the last 1-2 positions of the chunk.
                if i < 4 - pad {
                    return None;
                }
                0
            } else {
                val(b)? as u32
            };
            acc = (acc << 6) | six;
        }
        let bytes3 = acc.to_be_bytes(); // [_, hi, mid, lo]
        out.push(bytes3[1]);
        if pad < 2 {
            out.push(bytes3[2]);
        }
        if pad < 1 {
            out.push(bytes3[3]);
        }
    }
    Some(out)
}

/// Build the DALL·E prompt that anchors `front → back` as an absurd, memorable
/// scene. Split out so the command layer can construct it from a card and unit
/// tests can assert it without a network call.
///
/// When `back` is empty (cloze cards carry the whole sentence in `front`) the
/// prompt asks for an image of the sentence itself rather than a "→ ()" arrow.
pub fn build_image_prompt(front: &str, back: &str) -> String {
    let front = front.trim();
    let back = back.trim();
    let subject = if back.is_empty() {
        format!("« {front} »")
    } else {
        format!("« {front} » → « {back} »")
    };
    format!(
        "Image mnémotechnique absurde et mémorable représentant : {subject}. \
         Style illustration vivante et frappante, une seule scène, sans aucun texte ni lettres."
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prompt_includes_arrow_for_basic_card() {
        let p = build_image_prompt("Capitale du Japon ?", "Tokyo");
        assert!(p.contains("Capitale du Japon ?"));
        assert!(p.contains("Tokyo"));
        assert!(p.contains("→"));
        assert!(p.contains("absurde"));
    }

    #[test]
    fn prompt_has_no_arrow_for_cloze_card() {
        let p = build_image_prompt("La capitale du Japon est Tokyo", "");
        assert!(p.contains("La capitale du Japon est Tokyo"));
        assert!(!p.contains("→"), "cloze prompt should not contain an arrow");
    }

    #[test]
    fn decode_b64_round_trips_known_vector() {
        // "Man" -> "TWFu" (the canonical RFC 4648 example, no padding).
        assert_eq!(decode_b64_png("TWFu").unwrap(), b"Man");
        // "Ma" -> "TWE=" (one pad byte).
        assert_eq!(decode_b64_png("TWE=").unwrap(), b"Ma");
        // "M" -> "TQ==" (two pad bytes).
        assert_eq!(decode_b64_png("TQ==").unwrap(), b"M");
    }

    #[test]
    fn decode_b64_rejects_garbage() {
        assert!(decode_b64_png("not*base64!").is_none());
        assert!(decode_b64_png("abc").is_none(), "length not a multiple of 4");
        assert!(decode_b64_png("").is_none());
    }

    #[tokio::test]
    async fn generate_returns_no_api_key_when_empty() {
        let client = ImageClient::new(String::new());
        let err = client
            .generate("a vivid scene")
            .await
            .expect_err("empty key must short-circuit before any network call");
        assert!(matches!(err, ImageError::NoApiKey));
    }
}
