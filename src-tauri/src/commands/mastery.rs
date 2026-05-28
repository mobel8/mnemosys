//! Bayesian Knowledge Tracing (BKT) concept-mastery analytics.
//!
//! BKT (Corbett & Anderson 1995, *Knowledge tracing: Modeling the
//! acquisition of procedural knowledge*) treats each concept as a hidden
//! binary "mastered / not-mastered" state and updates the posterior
//! probability of mastery after every observed answer. Mnemosys groups
//! cards by **tag** (its stand-in for "concept") and replays each tag's
//! review history through the canonical two-step BKT update to surface a
//! "% mastery per concept" dashboard.
//!
//! Model parameters (the four classic BKT knobs):
//! - `p_L0`   — prior probability the concept is already known (0.40).
//! - `p_T`    — probability of transitioning unknown → known after a
//!   practice opportunity (0.20).
//! - `p_slip` — probability of answering wrong despite knowing it (0.10).
//! - `p_guess`— probability of answering right without knowing it (0.20).
//!
//! Update, per observation, with `L = P(mastered)`:
//! - correct:  `post = L·(1−slip) / [L·(1−slip) + (1−L)·guess]`
//! - incorrect:`post = L·slip     / [L·slip     + (1−L)·(1−guess)]`
//! - then learn: `L' = post + (1−post)·p_T`
//!
//! "Correct" follows the rest of the stats layer: a review counts as correct
//! when its rating is ≥ 3 (Good / Easy).

use std::collections::HashMap;

use serde::Serialize;
use tauri::State;

use crate::app_state::AppState;
use crate::error::AppResult;

/// BKT prior: probability a concept is known before any practice.
const P_L0: f64 = 0.4;
/// BKT transition: chance of learning the concept at each opportunity.
const P_TRANSIT: f64 = 0.2;
/// BKT slip: chance of a wrong answer despite mastery.
const P_SLIP: f64 = 0.1;
/// BKT guess: chance of a right answer without mastery.
const P_GUESS: f64 = 0.2;

/// How many tags (ranked by review volume) the dashboard surfaces.
const TOP_N_TAGS: usize = 30;

/// One concept's mastery estimate, ready for the stats UI.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ConceptMastery {
    /// The tag this concept maps to.
    pub tag: String,
    /// Posterior P(mastered) in `[0, 1]` after replaying every review.
    pub mastery: f64,
    /// Number of reviews that fed the estimate (also the ranking key).
    pub reviews: usize,
}

/// A single observed answer for a tag: `true` = correct (rating ≥ 3).
type Observation = bool;

#[tauri::command]
pub fn get_concept_mastery(state: State<'_, AppState>) -> AppResult<Vec<ConceptMastery>> {
    let conn = state.db.lock();

    // Pull every review joined to its card's note tags, in chronological
    // order. We parse the tags JSON in Rust (mirrors `NoteRepo::all_tags`)
    // and fan each review out across all of its card's tags. A card with no
    // tags simply contributes nothing.
    let mut stmt = conn.prepare(
        "SELECT n.tags, r.rating
         FROM reviews r
         JOIN cards c ON c.id = r.card_id
         JOIN notes n ON n.id = c.note_id
         ORDER BY r.reviewed_at ASC, r.id ASC",
    )?;

    // tag -> chronological list of correct/incorrect observations.
    let mut by_tag: HashMap<String, Vec<Observation>> = HashMap::new();

    let rows = stmt.query_map([], |row| {
        let tags_json: String = row.get(0)?;
        let rating: i64 = row.get(1)?;
        Ok((tags_json, rating))
    })?;

    for row in rows {
        let (tags_json, rating) = row?;
        // Skip notes whose tags fail to parse rather than aborting the whole
        // analytic — matches the defensive stance in `all_tags`.
        let tags: Vec<String> = match serde_json::from_str(&tags_json) {
            Ok(t) => t,
            Err(_) => continue,
        };
        let correct = rating >= 3;
        for tag in tags {
            by_tag.entry(tag).or_default().push(correct);
        }
    }

    let mut out: Vec<ConceptMastery> = by_tag
        .into_iter()
        .map(|(tag, observations)| {
            let mastery = bkt_mastery(&observations);
            ConceptMastery {
                tag,
                mastery,
                reviews: observations.len(),
            }
        })
        .collect();

    // Rank by review volume (most-practised concepts first); break ties by
    // tag name so the output is deterministic. Keep the top N.
    out.sort_by(|a, b| {
        b.reviews
            .cmp(&a.reviews)
            .then_with(|| a.tag.cmp(&b.tag))
    });
    out.truncate(TOP_N_TAGS);

    Ok(out)
}

/// Replay a chronological sequence of correct/incorrect observations through
/// the canonical BKT update and return the final P(mastered). An empty
/// sequence returns the prior `P_L0`.
///
/// Kept free of any DB access so it can be unit-tested directly.
fn bkt_mastery(observations: &[Observation]) -> f64 {
    let mut p_known = P_L0;
    for &correct in observations {
        // Evidence step — posterior given the observation.
        let posterior = if correct {
            let num = p_known * (1.0 - P_SLIP);
            let den = num + (1.0 - p_known) * P_GUESS;
            safe_ratio(num, den, p_known)
        } else {
            let num = p_known * P_SLIP;
            let den = num + (1.0 - p_known) * (1.0 - P_GUESS);
            safe_ratio(num, den, p_known)
        };
        // Learning step — chance the practice opportunity taught the concept.
        p_known = posterior + (1.0 - posterior) * P_TRANSIT;
    }
    p_known.clamp(0.0, 1.0)
}

/// `num / den`, falling back to `fallback` when the denominator is
/// non-positive (degenerate parameters / underflow) so we never divide by
/// zero or emit NaN.
fn safe_ratio(num: f64, den: f64, fallback: f64) -> f64 {
    if den > f64::EPSILON {
        num / den
    } else {
        fallback
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Core property: a run of correct answers drives mastery upward, well
    /// above the prior and approaching 1.0.
    #[test]
    fn bkt_mastery_increases_with_correct_reviews() {
        let none = bkt_mastery(&[]);
        assert!((none - P_L0).abs() < 1e-9, "empty history returns the prior");

        let few = bkt_mastery(&[true, true]);
        let many = bkt_mastery(&[true, true, true, true, true, true]);

        assert!(few > P_L0, "two correct answers must exceed the prior");
        assert!(many > few, "more correct answers push mastery higher");
        assert!(many < 1.0 && many > 0.9, "should approach but not exceed 1");
    }

    /// A run of wrong answers pulls mastery below the prior.
    #[test]
    fn bkt_mastery_drops_with_incorrect_reviews() {
        let wrong = bkt_mastery(&[false, false, false]);
        assert!(wrong < P_L0, "repeated failures fall below the prior");
        assert!(wrong >= 0.0);
    }

    /// Output always stays a valid probability even on adversarial input.
    #[test]
    fn bkt_mastery_stays_in_unit_interval() {
        let mixed = bkt_mastery(&[true, false, true, false, true, true, false]);
        assert!((0.0..=1.0).contains(&mixed));
    }
}
