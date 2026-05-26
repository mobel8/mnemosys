//! Anki `.apkg` importer (Vague A2.3).
//!
//! An `.apkg` file is a ZIP archive bundling:
//! - `collection.anki2` — SQLite database holding decks, notes, cards and the
//!   `col` row whose `decks` / `models` JSON blobs describe deck names and
//!   note types.
//! - `media` — JSON map `{ "0": "front.jpg", "1": "audio.mp3", ... }` linking
//!   the numerically-named blobs (`0`, `1`, …) to their original filenames.
//!
//! This MVP scope:
//! - Reads decks, notes and cards from a legacy `collection.anki2` schema.
//! - Maps Anki "Basic" / "Basic (and reversed)" / "Cloze" models to Mnemosys
//!   templates; other models are skipped (counted in the report).
//! - Drops review history — imported cards start fresh in the FSRS scheduler.
//! - Media files are listed but **not** copied into Mnemosys storage yet
//!   (Vague B will surface this through the UI).
//!
//! Out of scope for Session 2:
//! - The newer `collection.anki21b` (zstd-compressed) container. Users must
//!   re-export from Anki with the "Support older Anki versions" option.

pub mod converter;
pub mod parser;

#[cfg(test)]
mod tests;

pub use converter::{convert_to_mnemosys, ConversionResult, ConversionStats};
pub use parser::{parse_apkg, AnkiCard, AnkiCollection, AnkiDeck, AnkiModel, AnkiNote};
