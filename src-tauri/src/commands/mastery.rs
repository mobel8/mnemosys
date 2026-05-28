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

use chrono::{Datelike, TimeZone, Utc};
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

// ---------------------------------------------------------------------------
// Temporal Mastery Graph (Vague 23)
// ---------------------------------------------------------------------------

/// How many tags (ranked by review volume) the timeline surfaces. Kept small
/// so the line chart stays readable — too many overlapping lines is noise.
const TIMELINE_TOP_N_TAGS: usize = 8;

/// Hard cap on the requested window so an absurd `weeks` value can't make the
/// label vector or per-tag point vectors blow up.
const TIMELINE_MAX_WEEKS: u32 = 104;

/// Retention-over-time for the top tags, bucketed by ISO week.
///
/// Unlike [`ConceptMastery`] (a single BKT snapshot per tag), this exposes the
/// **trajectory**: for each surfaced tag, the share of correct reviews of its
/// cards in each of the last `weeks` ISO weeks. `points[i]` lines up with
/// `weeks[i]`; a `None` means the tag had zero reviews that week (the chart
/// draws a gap rather than a misleading 0%).
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct MasteryTimeline {
    /// ISO-week labels, oldest → newest (e.g. `"2026-W18"`).
    pub weeks: Vec<String>,
    /// One trajectory per surfaced tag.
    pub series: Vec<TagSeries>,
}

/// One tag's retention trajectory across the timeline's weeks.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct TagSeries {
    /// The tag (concept) this trajectory describes.
    pub tag: String,
    /// Retention in `[0, 1]` per week, aligned with [`MasteryTimeline::weeks`];
    /// `None` where the tag saw no reviews that week.
    pub points: Vec<Option<f64>>,
}

/// A single observed answer with the timestamp it happened at, used to bucket
/// reviews into ISO weeks. `correct` mirrors the rest of the stats layer
/// (rating ≥ 3).
struct TimedObservation {
    reviewed_at: i64,
    correct: bool,
}

#[tauri::command]
pub fn get_mastery_timeline(
    state: State<'_, AppState>,
    weeks: u32,
) -> AppResult<MasteryTimeline> {
    let weeks = weeks.clamp(1, TIMELINE_MAX_WEEKS);
    let now = Utc::now().timestamp();

    let conn = state.db.lock();

    // Same join as `get_concept_mastery`, but we also keep the timestamp so we
    // can bucket each review into an ISO week. Only pull rows new enough to
    // matter (a small slop of one week guards against off-by-one at the
    // boundary). Parsing of the tags JSON happens in Rust, mirroring `all_tags`.
    let since = now - i64::from(weeks + 1) * 7 * 86_400;
    let mut stmt = conn.prepare(
        "SELECT n.tags, r.rating, r.reviewed_at
         FROM reviews r
         JOIN cards c ON c.id = r.card_id
         JOIN notes n ON n.id = c.note_id
         WHERE r.reviewed_at >= ?1
         ORDER BY r.reviewed_at ASC, r.id ASC",
    )?;

    // tag -> chronological list of timestamped observations.
    let mut by_tag: HashMap<String, Vec<TimedObservation>> = HashMap::new();

    let rows = stmt.query_map([since], |row| {
        let tags_json: String = row.get(0)?;
        let rating: i64 = row.get(1)?;
        let reviewed_at: i64 = row.get(2)?;
        Ok((tags_json, rating, reviewed_at))
    })?;

    for row in rows {
        let (tags_json, rating, reviewed_at) = row?;
        let tags: Vec<String> = match serde_json::from_str(&tags_json) {
            Ok(t) => t,
            Err(_) => continue,
        };
        let correct = rating >= 3;
        for tag in tags {
            by_tag
                .entry(tag)
                .or_default()
                .push(TimedObservation { reviewed_at, correct });
        }
    }

    Ok(build_timeline(&by_tag, weeks, now))
}

/// Pure timeline builder, free of DB/IPC so it can be unit-tested directly.
///
/// Produces `weeks` ISO-week labels ending at the week containing `now`, then
/// for the [`TIMELINE_TOP_N_TAGS`] busiest tags computes per-week retention.
/// Tags are ranked by total review volume in the window (ties broken by name)
/// so the output is deterministic.
fn build_timeline(
    by_tag: &HashMap<String, Vec<TimedObservation>>,
    weeks: u32,
    now: i64,
) -> MasteryTimeline {
    // Build the ordered list of week keys (oldest → newest) and a key → index
    // lookup so each observation lands in O(1).
    let weeks = weeks.max(1) as usize;
    let mut week_labels: Vec<String> = Vec::with_capacity(weeks);
    let mut label_to_idx: HashMap<String, usize> = HashMap::with_capacity(weeks);
    for offset in (0..weeks).rev() {
        // Step back `offset` weeks from `now`; label by the ISO week it falls in.
        let ts = now - (offset as i64) * 7 * 86_400;
        let label = iso_week_label(ts);
        // Distinct timestamps can map to the same ISO week only at exact
        // 7-day strides from `now`, which they never do here, so each label
        // is unique. Guard anyway to keep `label_to_idx` consistent.
        label_to_idx
            .entry(label.clone())
            .or_insert(week_labels.len());
        week_labels.push(label);
    }

    // Rank tags by volume (desc), tie-break by name (asc) for determinism.
    let mut ranked: Vec<(&String, usize)> =
        by_tag.iter().map(|(tag, obs)| (tag, obs.len())).collect();
    ranked.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(b.0)));
    ranked.truncate(TIMELINE_TOP_N_TAGS);

    let series = ranked
        .into_iter()
        .map(|(tag, _)| {
            // Per-week tallies: (correct, total).
            let mut totals = vec![(0u32, 0u32); week_labels.len()];
            for ob in &by_tag[tag] {
                let label = iso_week_label(ob.reviewed_at);
                if let Some(&idx) = label_to_idx.get(&label) {
                    totals[idx].1 += 1;
                    if ob.correct {
                        totals[idx].0 += 1;
                    }
                }
            }
            let points = totals
                .into_iter()
                .map(|(correct, total)| {
                    if total > 0 {
                        Some(f64::from(correct) / f64::from(total))
                    } else {
                        None
                    }
                })
                .collect();
            TagSeries {
                tag: tag.clone(),
                points,
            }
        })
        .collect();

    MasteryTimeline {
        weeks: week_labels,
        series,
    }
}

/// ISO-8601 week label for a unix timestamp, e.g. `"2026-W18"`. Uses the
/// ISO week-numbering year (which can differ from the calendar year in late
/// December / early January) so weeks stay contiguous across year boundaries.
fn iso_week_label(ts: i64) -> String {
    // `timestamp_opt` is the non-panicking constructor; fall back to the epoch
    // on the impossible out-of-range case rather than unwrapping.
    let dt = match Utc.timestamp_opt(ts, 0).single() {
        Some(dt) => dt,
        None => Utc.timestamp_opt(0, 0).single().unwrap_or_default(),
    };
    let iso = dt.iso_week();
    format!("{}-W{:02}", iso.year(), iso.week())
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

    const WEEK: i64 = 7 * 86_400;

    /// The timeline buckets each tag's reviews into the right ISO week and
    /// computes per-week retention, leaving `None` where a tag had no reviews.
    #[test]
    fn mastery_timeline_groups_by_week_and_tag() {
        // Pin "now" to a fixed instant so the week math is deterministic.
        let now = Utc
            .with_ymd_and_hms(2026, 5, 28, 12, 0, 0)
            .single()
            .expect("valid now")
            .timestamp();

        let mut by_tag: HashMap<String, Vec<TimedObservation>> = HashMap::new();
        // "anatomie": this week → 2/2 correct; one week ago → 1/2 correct.
        by_tag.insert(
            "anatomie".into(),
            vec![
                TimedObservation { reviewed_at: now, correct: true },
                TimedObservation { reviewed_at: now - 3_600, correct: true },
                TimedObservation { reviewed_at: now - WEEK, correct: true },
                TimedObservation { reviewed_at: now - WEEK - 3_600, correct: false },
            ],
        );
        // "physio": only two weeks ago → 0/1 (a single wrong answer).
        by_tag.insert(
            "physio".into(),
            vec![TimedObservation { reviewed_at: now - 2 * WEEK, correct: false }],
        );

        let timeline = build_timeline(&by_tag, 3, now);

        // Three week labels, oldest → newest, all distinct.
        assert_eq!(timeline.weeks.len(), 3);
        assert_eq!(timeline.weeks, {
            let mut sorted = timeline.weeks.clone();
            sorted.sort();
            sorted
        });

        // Ranked by volume: anatomie (4 obs) before physio (1 obs).
        assert_eq!(timeline.series.len(), 2);
        assert_eq!(timeline.series[0].tag, "anatomie");
        assert_eq!(timeline.series[1].tag, "physio");

        let anat = &timeline.series[0].points;
        assert_eq!(anat.len(), 3);
        // Oldest week (idx 0): anatomie had no reviews → None.
        assert_eq!(anat[0], None);
        // One week ago (idx 1): 1/2 correct.
        assert_eq!(anat[1], Some(0.5));
        // Current week (idx 2): 2/2 correct.
        assert_eq!(anat[2], Some(1.0));

        let physio = &timeline.series[1].points;
        // physio only reviewed in the oldest week: 0/1 → Some(0.0), rest None.
        assert_eq!(physio[0], Some(0.0));
        assert_eq!(physio[1], None);
        assert_eq!(physio[2], None);
    }

    /// No reviews → empty series but the week scaffold is still returned so the
    /// chart can render an axis (and its empty state) without special-casing.
    #[test]
    fn mastery_timeline_empty_when_no_reviews() {
        let now = Utc::now().timestamp();
        let timeline = build_timeline(&HashMap::new(), 4, now);
        assert_eq!(timeline.weeks.len(), 4);
        assert!(timeline.series.is_empty());
    }
}
