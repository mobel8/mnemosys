//! Reading Import repository (Vague 17 — LingQ-style word tracking).
//!
//! Backs the "paste a text, classify each word" flow. A [`WordStatus`] row
//! records one learner classification (`new` / `learning` / `known`) for a
//! `(word, language)` pair. Words are normalised (trimmed + lower-cased) on
//! every write and every lookup so casing never fragments a learner's
//! vocabulary — "Chat", "chat" and "CHAT" all map to the same row.
//!
//! The repo also knows how to mint Basic flashcards from a batch of words
//! (the "create cards from unknown words" action), delegating card creation
//! to [`NoteRepo`] so the derived `cards` rows and the FTS index stay
//! consistent with every other note-creation path.

use chrono::Utc;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

use super::notes::{NoteRepo, NoteTemplate};

/// Accepted `word_status.status` values. Mirrors the SQL `CHECK` constraint.
const STATUSES: &[&str] = &["new", "learning", "known"];

/// Placeholder back text for cards minted from unknown words. The learner is
/// expected to fill in the real translation later.
const TRANSLATION_PLACEHOLDER: &str = "(à traduire)";

/// One persisted word classification. `word` and `language` are always the
/// normalised (trimmed, lower-cased) forms the repo stored.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WordStatus {
    pub word: String,
    pub language: String,
    pub status: String,
    pub updated_at: i64,
}

/// Normalise a raw token into the canonical key used by `word_status`:
/// trimmed and lower-cased. Unicode-aware lower-casing (`to_lowercase`) keeps
/// accented vocabulary (« Étudier » → « étudier ») coherent.
fn normalize_word(raw: &str) -> String {
    raw.trim().to_lowercase()
}

fn validate_status(status: &str) -> AppResult<()> {
    if STATUSES.contains(&status) {
        Ok(())
    } else {
        Err(AppError::Validation(format!(
            "invalid word status '{}' (expected one of {:?})",
            status, STATUSES
        )))
    }
}

pub struct ReadingRepo<'a> {
    conn: &'a Connection,
}

impl<'a> ReadingRepo<'a> {
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }

    /// Look up the stored status of each word in `words` for `language`.
    ///
    /// Only words that actually have a row are returned — the caller treats a
    /// missing word as implicitly `new`. Input words are normalised before the
    /// lookup, and duplicate / blank inputs are collapsed so a 5 000-word text
    /// issues at most one row per distinct token. Order is not guaranteed.
    pub fn get_word_statuses(
        &self,
        words: &[String],
        language: &str,
    ) -> AppResult<Vec<WordStatus>> {
        // Deduplicate + normalise up front; bail early on an empty request so
        // we never build a degenerate `IN ()` clause.
        let mut wanted: Vec<String> = words
            .iter()
            .map(|w| normalize_word(w))
            .filter(|w| !w.is_empty())
            .collect();
        wanted.sort();
        wanted.dedup();
        if wanted.is_empty() {
            return Ok(Vec::new());
        }

        let mut out = Vec::new();
        // Chunk the IN-list to stay well under SQLite's default 999-variable
        // limit (we bind `language` too, so cap the word slice at 900).
        for chunk in wanted.chunks(900) {
            // `repeat_n` is only stable since Rust 1.82; this crate pins MSRV
            // 1.81, so use the long-stable `repeat().take()` form instead.
            let placeholders = std::iter::repeat("?")
                .take(chunk.len())
                .collect::<Vec<_>>()
                .join(", ");
            let sql = format!(
                "SELECT word, language, status, updated_at
                 FROM word_status
                 WHERE language = ?1 AND word IN ({})",
                placeholders
            );
            let mut stmt = self.conn.prepare(&sql)?;
            // Param 1 is the language; the word placeholders start at index 2.
            let mut bound: Vec<&dyn rusqlite::ToSql> = Vec::with_capacity(chunk.len() + 1);
            bound.push(&language);
            for w in chunk {
                bound.push(w);
            }
            let rows = stmt.query_map(bound.as_slice(), |row| {
                Ok(WordStatus {
                    word: row.get(0)?,
                    language: row.get(1)?,
                    status: row.get(2)?,
                    updated_at: row.get(3)?,
                })
            })?;
            for r in rows {
                out.push(r?);
            }
        }
        Ok(out)
    }

    /// Upsert one word's status. The word is normalised before storage; the
    /// `(word, language)` primary key makes this idempotent — re-marking a
    /// word just refreshes `status` + `updated_at`.
    pub fn set_word_status(
        &self,
        word: &str,
        status: &str,
        language: &str,
    ) -> AppResult<WordStatus> {
        validate_status(status)?;
        let normalized = normalize_word(word);
        if normalized.is_empty() {
            return Err(AppError::Validation("word must not be empty".into()));
        }
        let now = Utc::now().timestamp();
        self.conn.execute(
            "INSERT INTO word_status (word, language, status, updated_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(word, language)
             DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at",
            params![normalized, language, status, now],
        )?;
        Ok(WordStatus {
            word: normalized,
            language: language.to_string(),
            status: status.to_string(),
            updated_at: now,
        })
    }

    /// Mint one Basic note (front = word, back = translation or placeholder)
    /// per distinct word in `words`, inside `deck_id`. Returns how many notes
    /// were created.
    ///
    /// `translations` is a parallel slice (Vague 17, P079): when a word at
    /// index `i` has a non-empty `translations[i]`, that gloss becomes the
    /// verso instead of the `(à traduire)` placeholder. The front-end fills it
    /// from its embedded English→French dictionary (`lookupLocal`) so reading
    /// cards land pre-translated for common words, exactly like the
    /// Vocabulary Builder — no more hand-retranslating « new = nouveau ». Pass
    /// an empty slice (or shorter than `words`) to fall back to the
    /// placeholder for the un-glossed tail.
    ///
    /// Words are normalised + deduplicated first; blank inputs are skipped.
    /// Card creation goes through [`NoteRepo::create_inner`] so the derived
    /// `cards` row and the FTS index land exactly as they would for a
    /// hand-typed card. P064: the WHOLE batch runs inside ONE transaction —
    /// a 5 000-word import pays a single commit/fsync instead of one per note,
    /// and a failure mid-batch rolls every note back (the call is documented
    /// as one logical action, so it must also be atomic).
    pub fn create_cards_from_words(
        &self,
        deck_id: i64,
        words: &[String],
        translations: &[String],
    ) -> AppResult<usize> {
        self.conn.execute_batch("BEGIN;")?;
        match self.create_cards_from_words_inner(deck_id, words, translations) {
            Ok(created) => {
                self.conn.execute_batch("COMMIT;")?;
                Ok(created)
            }
            Err(e) => {
                let _ = self.conn.execute_batch("ROLLBACK;");
                Err(e)
            }
        }
    }

    /// P064 — body of [`Self::create_cards_from_words`], run inside the
    /// caller's transaction. Delegates to [`NoteRepo::create_inner`] (no
    /// per-note BEGIN/COMMIT) so the batch commits once.
    fn create_cards_from_words_inner(
        &self,
        deck_id: i64,
        words: &[String],
        translations: &[String],
    ) -> AppResult<usize> {
        let mut seen = std::collections::BTreeSet::new();
        let mut created = 0usize;
        let notes = NoteRepo::new(self.conn);
        for (i, raw) in words.iter().enumerate() {
            let normalized = normalize_word(raw);
            if normalized.is_empty() || !seen.insert(normalized.clone()) {
                continue;
            }
            // P079 — prefer the supplied gloss; fall back to the placeholder
            // when it's missing or blank.
            let back = translations
                .get(i)
                .map(|t| t.trim())
                .filter(|t| !t.is_empty())
                .unwrap_or(TRANSLATION_PLACEHOLDER);
            let fields = serde_json::json!({
                "front": normalized,
                "back": back,
            });
            notes.create_inner(
                deck_id,
                NoteTemplate::Basic,
                fields,
                vec!["reading".to_string()],
                None,
            )?;
            created += 1;
        }
        Ok(created)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;

    fn seed_deck(db: &Database) -> i64 {
        let conn = db.lock();
        db.decks(&conn)
            .create("Lecture", None, "#3b82f6", 0.9, None, Some("en"), None)
            .expect("seed deck")
            .id
    }

    #[test]
    fn set_then_get_round_trips_normalised() {
        let db = Database::for_test();
        let conn = db.lock();
        let repo = ReadingRepo::new(&conn);

        // Mixed case + surrounding whitespace must normalise to one row.
        repo.set_word_status("  Bonjour  ", "learning", "fr")
            .expect("set");
        let got = repo
            .get_word_statuses(&["bonjour".to_string(), "BONJOUR".to_string()], "fr")
            .expect("get");
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].word, "bonjour");
        assert_eq!(got[0].status, "learning");
    }

    #[test]
    fn set_word_status_is_idempotent_upsert() {
        let db = Database::for_test();
        let conn = db.lock();
        let repo = ReadingRepo::new(&conn);

        repo.set_word_status("hola", "new", "es").expect("first");
        repo.set_word_status("hola", "known", "es").expect("update");
        let got = repo
            .get_word_statuses(&["hola".to_string()], "es")
            .expect("get");
        assert_eq!(got.len(), 1, "upsert must not create a duplicate row");
        assert_eq!(got[0].status, "known");
    }

    #[test]
    fn status_per_language_is_independent() {
        let db = Database::for_test();
        let conn = db.lock();
        let repo = ReadingRepo::new(&conn);

        repo.set_word_status("chat", "known", "fr").expect("fr");
        repo.set_word_status("chat", "learning", "en").expect("en");
        let fr = repo
            .get_word_statuses(&["chat".to_string()], "fr")
            .expect("fr get");
        let en = repo
            .get_word_statuses(&["chat".to_string()], "en")
            .expect("en get");
        assert_eq!(fr[0].status, "known");
        assert_eq!(en[0].status, "learning");
    }

    #[test]
    fn rejects_invalid_status() {
        let db = Database::for_test();
        let conn = db.lock();
        let repo = ReadingRepo::new(&conn);
        assert!(repo.set_word_status("x", "mastered", "en").is_err());
    }

    #[test]
    fn empty_word_list_returns_empty() {
        let db = Database::for_test();
        let conn = db.lock();
        let repo = ReadingRepo::new(&conn);
        let got = repo.get_word_statuses(&[], "en").expect("empty get");
        assert!(got.is_empty());
    }

    #[test]
    fn create_cards_dedups_and_counts() {
        let db = Database::for_test();
        let deck_id = seed_deck(&db);
        let conn = db.lock();
        let repo = ReadingRepo::new(&conn);

        let words = vec![
            "apple".to_string(),
            "Apple".to_string(), // dup after normalisation
            "  ".to_string(),    // blank, skipped
            "banana".to_string(),
        ];
        let n = repo
            .create_cards_from_words(deck_id, &words, &[])
            .expect("create");
        assert_eq!(n, 2, "only two distinct non-blank words become cards");

        // The notes really landed in the deck.
        let notes = db.notes(&conn).list_in_deck(deck_id, 50, 0).expect("list");
        assert_eq!(notes.len(), 2);
    }

    /// P079 — a supplied translation becomes the verso; a missing/blank one
    /// falls back to the placeholder. The slice is positional w.r.t. `words`.
    #[test]
    fn create_cards_uses_supplied_translations() {
        let db = Database::for_test();
        let deck_id = seed_deck(&db);
        let conn = db.lock();
        let repo = ReadingRepo::new(&conn);

        let words = vec!["new".to_string(), "xyzzy".to_string()];
        // "new" gets a gloss; "xyzzy" has a blank slot → placeholder.
        let translations = vec!["nouveau".to_string(), "   ".to_string()];
        let n = repo
            .create_cards_from_words(deck_id, &words, &translations)
            .expect("create");
        assert_eq!(n, 2);

        let notes = db.notes(&conn).list_in_deck(deck_id, 50, 0).expect("list");
        let back_of = |word: &str| -> String {
            notes
                .iter()
                .find(|note| note.fields.get("front").and_then(|v| v.as_str()) == Some(word))
                .and_then(|note| note.fields.get("back").and_then(|v| v.as_str()))
                .unwrap_or_default()
                .to_string()
        };
        assert_eq!(back_of("new"), "nouveau", "supplied gloss wins");
        assert_eq!(
            back_of("xyzzy"),
            TRANSLATION_PLACEHOLDER,
            "blank gloss falls back to the placeholder"
        );
    }

    /// P064 — a failure mid-batch rolls the whole batch back (the call is one
    /// logical action). Feeding a non-existent deck makes `create_for_note`'s
    /// FK insert fail, so no note from the batch must survive.
    #[test]
    fn create_cards_is_atomic_on_failure() {
        let db = Database::for_test();
        let conn = db.lock();
        let repo = ReadingRepo::new(&conn);

        let words = vec!["alpha".to_string(), "beta".to_string()];
        // deck_id = 999_999 doesn't exist → the cards FK violation aborts.
        let result = repo.create_cards_from_words(999_999, &words, &[]);
        assert!(result.is_err(), "an invalid deck must fail the batch");

        // Nothing leaked: zero notes were committed.
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM notes", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0, "a failed batch leaves no notes behind");
    }
}
