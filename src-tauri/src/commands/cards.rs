//! Note + card management commands.
//!
//! Note creation also creates the matching card rows (handled inside
//! [`NoteRepo::create`](crate::db::NoteRepo::create)). The frontend
//! therefore only calls `create_note` to add new SRS content.

use std::collections::HashMap;

use serde::Serialize;
use tauri::State;

use crate::app_state::AppState;
use crate::db::{Card, CardWithNote, FrequencyCoverage, Note, NoteTemplate};
use crate::error::AppResult;

#[tauri::command]
pub fn list_cards_in_deck(
    state: State<'_, AppState>,
    deck_id: i64,
    limit: u32,
    offset: u32,
) -> AppResult<Vec<CardWithNote>> {
    let conn = state.db.lock();
    state.db.cards(&conn).list_in_deck(deck_id, limit, offset)
}

/// P017: resolve a single card + its note in one JOIN, so `PalaceReview` can
/// fetch only the locus's card instead of loading every deck's cards.
#[tauri::command]
pub fn get_card_with_note(state: State<'_, AppState>, card_id: i64) -> AppResult<CardWithNote> {
    let conn = state.db.lock();
    state.db.cards(&conn).get_with_note(card_id)
}

#[tauri::command]
pub fn search_notes(state: State<'_, AppState>, query: String, limit: u32) -> AppResult<Vec<Note>> {
    let conn = state.db.lock();
    state.db.notes(&conn).search(&query, limit)
}

/// Create a note (and its derived cards).
///
/// `frequency_band` is the optional Vague 10 Zipf-bucket label
/// (`top_100` … `beyond`); `None`/omitted leaves the note un-tagged.
#[tauri::command]
pub fn create_note(
    state: State<'_, AppState>,
    deck_id: i64,
    template: NoteTemplate,
    fields: serde_json::Value,
    tags: Vec<String>,
    frequency_band: Option<String>,
) -> AppResult<Note> {
    let conn = state.db.lock();
    state
        .db
        .notes(&conn)
        .create(deck_id, template, fields, tags, frequency_band)
}

/// Update a note's fields. P049: [`NoteRepo::update_fields`] reconciles the
/// derived cards in the same transaction, so editing a cloze/occlusion note's
/// arity (adding/removing a `{{cN::}}` marker or a mask) creates the missing
/// cards and drops the orphaned ones — no manual card surgery needed here.
#[tauri::command]
pub fn update_note(
    state: State<'_, AppState>,
    id: i64,
    fields: serde_json::Value,
) -> AppResult<Note> {
    let conn = state.db.lock();
    state.db.notes(&conn).update_fields(id, fields)
}

#[tauri::command]
pub fn delete_note(state: State<'_, AppState>, id: i64) -> AppResult<()> {
    let conn = state.db.lock();
    state.db.notes(&conn).delete(id)
}

#[tauri::command]
pub fn suspend_card(state: State<'_, AppState>, id: i64, suspended: bool) -> AppResult<()> {
    let conn = state.db.lock();
    state.db.cards(&conn).suspend(id, suspended)
}

/// Reset a card to `new`, clearing every FSRS scheduling field.
///
/// The `reviews` history is intentionally preserved so retention stats stay
/// truthful. Returns the freshly-reset card so the UI can re-render it.
#[tauri::command]
pub fn reset_card(state: State<'_, AppState>, id: i64) -> AppResult<Card> {
    let conn = state.db.lock();
    state.db.cards(&conn).reset(id)
}

/// Vague 10 — count a deck's notes by frequency band for the coverage card.
/// Thin wrapper over [`NoteRepo::frequency_coverage`](crate::db::NoteRepo).
#[tauri::command]
pub fn get_frequency_coverage(
    state: State<'_, AppState>,
    deck_id: i64,
) -> AppResult<FrequencyCoverage> {
    let conn = state.db.lock();
    state.db.notes(&conn).frequency_coverage(deck_id)
}

// ---------------------------------------------------------------------------
// Vague 11 — Knowledge Graph (tag co-occurrence)
// ---------------------------------------------------------------------------

/// One node in the tag graph — a distinct tag and how many notes carry it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TagNode {
    pub tag: String,
    pub count: usize,
}

/// One undirected edge — two tags that co-occur on `weight` notes. `source`
/// and `target` are always emitted in a stable (sorted) order so the frontend
/// never sees the same pair twice under swapped endpoints.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TagEdge {
    pub source: String,
    pub target: String,
    pub weight: usize,
}

/// The full graph payload consumed by `KnowledgeGraph.tsx`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct TagGraph {
    pub nodes: Vec<TagNode>,
    pub edges: Vec<TagEdge>,
}

/// Cap on the number of nodes returned, to keep the SVG layout tractable.
const MAX_TAG_NODES: usize = 50;

/// Pure graph builder — fed the per-note tag lists, returns nodes + edges.
///
/// - **Nodes**: every distinct tag, with `count` = number of notes carrying
///   it. Only the top [`MAX_TAG_NODES`] by count are kept (ties broken
///   alphabetically for determinism).
/// - **Edges**: for each note, every unordered pair of its (retained) tags
///   contributes 1 to that pair's weight. Pairs touching a tag that didn't
///   make the top-N cut are dropped so edges never dangle.
///
/// Kept free of any DB/Tauri types so it's unit-testable in isolation.
pub fn compute_tag_graph(note_tags: &[Vec<String>]) -> TagGraph {
    // 1. Tally how many notes carry each tag (dedupe within a note first so a
    //    note that lists the same tag twice doesn't double-count).
    let mut counts: HashMap<&str, usize> = HashMap::new();
    for tags in note_tags {
        let mut seen: Vec<&str> = Vec::new();
        for tag in tags {
            let t = tag.as_str();
            if !t.is_empty() && !seen.contains(&t) {
                seen.push(t);
                *counts.entry(t).or_insert(0) += 1;
            }
        }
    }

    // 2. Keep the top-N tags by count (then alphabetical for stable output).
    let mut ranked: Vec<(&str, usize)> = counts.into_iter().collect();
    ranked.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(b.0)));
    ranked.truncate(MAX_TAG_NODES);

    let kept: std::collections::HashSet<&str> = ranked.iter().map(|(t, _)| *t).collect();

    // 3. Co-occurrence: accumulate weights for each unordered pair, both
    //    endpoints of which survived the top-N cut. Key is sorted so (a,b)
    //    and (b,a) collapse together.
    let mut edge_weights: HashMap<(&str, &str), usize> = HashMap::new();
    for tags in note_tags {
        // Per-note distinct, retained tags only.
        let mut present: Vec<&str> = Vec::new();
        for tag in tags {
            let t = tag.as_str();
            if kept.contains(t) && !present.contains(&t) {
                present.push(t);
            }
        }
        present.sort_unstable();
        for i in 0..present.len() {
            for j in (i + 1)..present.len() {
                *edge_weights.entry((present[i], present[j])).or_insert(0) += 1;
            }
        }
    }

    let nodes = ranked
        .into_iter()
        .map(|(tag, count)| TagNode {
            tag: tag.to_string(),
            count,
        })
        .collect();

    let mut edges: Vec<TagEdge> = edge_weights
        .into_iter()
        .map(|((source, target), weight)| TagEdge {
            source: source.to_string(),
            target: target.to_string(),
            weight,
        })
        .collect();
    // Stable order: heaviest edges first, then alphabetical — keeps the
    // serialized payload deterministic for snapshot-style tests.
    edges.sort_by(|a, b| {
        b.weight
            .cmp(&a.weight)
            .then_with(|| a.source.cmp(&b.source))
            .then_with(|| a.target.cmp(&b.target))
    });

    TagGraph { nodes, edges }
}

/// Vague 11 — build the tag co-occurrence graph for the Knowledge Graph view.
/// `deck_id = None` spans every deck; `Some(id)` scopes to one deck.
#[tauri::command]
pub fn get_tag_graph(state: State<'_, AppState>, deck_id: Option<i64>) -> AppResult<TagGraph> {
    let conn = state.db.lock();
    let note_tags = state.db.notes(&conn).all_tags(deck_id)?;
    Ok(compute_tag_graph(&note_tags))
}

#[cfg(test)]
mod tag_graph_tests {
    use super::*;

    #[test]
    fn tag_graph_computes_cooccurrence() {
        // Three notes: tags overlap so we get predictable co-occurrence.
        let notes = vec![
            vec!["verb".to_string(), "french".to_string()],
            vec!["verb".to_string(), "french".to_string()],
            vec!["noun".to_string(), "french".to_string()],
        ];
        let graph = compute_tag_graph(&notes);

        // Nodes: french (3), verb (2), noun (1).
        assert_eq!(graph.nodes.len(), 3);
        let french = graph.nodes.iter().find(|n| n.tag == "french").unwrap();
        assert_eq!(french.count, 3);
        let verb = graph.nodes.iter().find(|n| n.tag == "verb").unwrap();
        assert_eq!(verb.count, 2);

        // Edges: (french,verb) weight 2; (french,noun) weight 1. No (verb,noun).
        let fv = graph
            .edges
            .iter()
            .find(|e| e.source == "french" && e.target == "verb")
            .unwrap();
        assert_eq!(fv.weight, 2);
        let fn_edge = graph
            .edges
            .iter()
            .find(|e| e.source == "french" && e.target == "noun")
            .unwrap();
        assert_eq!(fn_edge.weight, 1);
        assert!(!graph
            .edges
            .iter()
            .any(|e| (e.source == "noun" && e.target == "verb")
                || (e.source == "verb" && e.target == "noun")));
    }

    #[test]
    fn tag_graph_empty_and_singletons() {
        // No notes → empty graph.
        assert_eq!(compute_tag_graph(&[]), TagGraph::default());
        // A note with a single tag yields one node and zero edges.
        let graph = compute_tag_graph(&[vec!["solo".to_string()]]);
        assert_eq!(graph.nodes.len(), 1);
        assert!(graph.edges.is_empty());
    }

    #[test]
    fn tag_graph_dedupes_within_note() {
        // A note listing the same tag twice must count it once.
        let graph = compute_tag_graph(&[vec!["dup".to_string(), "dup".to_string()]]);
        assert_eq!(graph.nodes[0].count, 1);
        assert!(graph.edges.is_empty());
    }
}
