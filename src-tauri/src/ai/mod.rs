//! AI service backend — Claude-powered flashcard generation (Vague A2.1).
//!
//! Three concerns are separated:
//! - [`claude`] — thin HTTP wrapper around Anthropic's Messages API.
//! - [`cards`]  — prompt + JSON parser to turn raw text into
//!   [`GeneratedCard`]s.
//! - [`pdf`]    — text extraction + paragraph-aware chunking so long PDFs
//!   stay within reasonable per-request context windows.
//!
//! The module is intentionally side-effect free: it never touches the DB
//! and never reads settings. The Tauri command layer
//! ([`commands::ai`](crate::commands::ai)) is responsible for resolving
//! the API key and persisting the resulting cards.

pub mod cards;
pub mod claude;
pub mod critic;
pub mod mnemonic;
pub mod pdf;
pub mod podcast;

#[cfg(test)]
mod tests;

pub use cards::{
    generate_cards_from_pdf, generate_cards_from_text, CardTemplate, GeneratedCard,
};
pub use claude::{ClaudeClient, ClaudeError};
pub use critic::{critique_cards, CardCritique};
pub use mnemonic::generate_mnemonic;
pub use pdf::{chunk_text, extract_pdf_text};
pub use podcast::{generate_podcast_script, PodcastFormat, PodcastLine};
