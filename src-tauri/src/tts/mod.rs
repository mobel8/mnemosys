//! Text-to-speech service backend (Vague A2.2).
//!
//! Architecture
//! ============
//! Two thin layers wrap a single OpenAI HTTP call:
//! - [`openai::OpenAIClient`] — async POST to `audio/speech`, returns raw MP3 bytes.
//! - [`cache::TTSCache`]      — hash-addressed on-disk cache so repeated
//!   syntheses of the same `text + voice + speed` are a free `fs::read`.
//!
//! The Tauri commands ([`crate::commands::tts`]) tie them together: check
//! cache first, hit the API on a miss, then write the resulting MP3 to disk
//! before returning the absolute path to the frontend. The path is what the
//! UI feeds into `convertFileSrc()` to play through an `<audio>` element.
//!
//! Why not stream?
//! ---------------
//! Cache hits dominate steady-state usage (a flashcard's audio doesn't
//! change), so streaming would only help the very first request and would
//! force us to keep two playback code paths in the UI. Buffering the full
//! response keeps the call site trivial: one path always points at a
//! finished MP3 file on disk.

pub mod cache;
pub mod openai;

#[cfg(test)]
mod tests;

pub use cache::TTSCache;
pub use openai::{OpenAIClient, TTSError, Voice};
