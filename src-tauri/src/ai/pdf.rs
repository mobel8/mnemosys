//! PDF text extraction + paragraph-aware chunking.
//!
//! The Anthropic Messages API accepts up to ~200k input tokens, but card
//! generation quality plateaus well before that — and one giant prompt
//! produces a single mega-response that's harder to recover from on failure.
//! So we split long documents into ~4k character paragraphs and generate
//! cards per-chunk. Failures of one chunk don't poison the whole batch
//! (see `cards::generate_cards_from_pdf`).

/// Extract the document's full plain text using `pdf-extract`.
///
/// Returns a `String` with raw text (form-feed separators between pages are
/// kept as `\n\n` so the chunker can use them as paragraph boundaries).
/// Failure modes: corrupt PDF, encrypted PDF without password, fonts we
/// cannot decode — all collapsed into a single `String` error since
/// callers only need to report it to the user.
pub fn extract_pdf_text(bytes: &[u8]) -> Result<String, String> {
    pdf_extract::extract_text_from_mem(bytes).map_err(|e| format!("PDF extract error: {}", e))
}

/// Split `text` into chunks of at most ~`target_chars` characters,
/// preferring paragraph (`\n\n`) boundaries so we never cut a sentence in
/// half between LLM calls.
///
/// Guarantees:
/// - never returns an empty Vec when `text` has non-whitespace content;
/// - never produces an empty chunk;
/// - a single oversized paragraph is kept whole (we don't hard-split words);
/// - chunks never grow past `target_chars + len(longest_paragraph)`.
pub fn chunk_text(text: &str, target_chars: usize) -> Vec<String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }
    if trimmed.len() <= target_chars {
        return vec![trimmed.to_string()];
    }

    let mut chunks: Vec<String> = Vec::new();
    let mut current = String::new();

    for paragraph in trimmed
        .split("\n\n")
        .map(str::trim)
        .filter(|p| !p.is_empty())
    {
        // If appending the next paragraph would blow the budget *and* we
        // already have content buffered, flush before starting fresh.
        if !current.is_empty() && current.len() + paragraph.len() + 2 > target_chars {
            chunks.push(std::mem::take(&mut current));
        }
        if !current.is_empty() {
            current.push_str("\n\n");
        }
        current.push_str(paragraph);
    }

    if !current.is_empty() {
        chunks.push(current);
    }
    chunks
}
