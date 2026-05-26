//! Review session commands.
//!
//! Three call patterns from the UI:
//! 1. `get_due_cards` to populate the queue at session start.
//! 2. `preview_next_states` to show the four "if you press X, next due is …"
//!    chips above each card.
//! 3. `submit_review` once the user grades the card. Returns the freshly
//!    updated [`Card`] along with the chosen interval so the UI can render
//!    a "next review in N days" toast.
//!
//! All scheduling math goes through the [`CardScheduler`](crate::fsrs::CardScheduler)
//! held in [`AppState`].

use serde::Serialize;
use tauri::State;

use crate::app_state::AppState;
use crate::db::{Card, CardState, CardWithNote, NewReview};
use crate::error::AppResult;
use crate::fsrs::{MemoryStateDTO, NextStatesDTO, Rating};

/// Result returned by [`submit_review`]: the updated card row + the scheduled
/// interval the user just earned. The interval is also derivable from
/// `card.scheduled_days` but exposing it explicitly keeps the UI code simple.
#[derive(Debug, Clone, Serialize)]
pub struct ReviewResultDTO {
    pub card: Card,
    pub scheduled_days: u32,
}

#[tauri::command]
pub fn get_due_cards(
    state: State<'_, AppState>,
    deck_id: Option<i64>,
    limit: u32,
) -> AppResult<Vec<CardWithNote>> {
    let now = chrono::Utc::now().timestamp();
    let conn = state.db.lock();
    state.db.cards(&conn).due_cards(deck_id, now, limit)
}

#[tauri::command]
pub fn preview_next_states(
    state: State<'_, AppState>,
    card_id: i64,
) -> AppResult<NextStatesDTO> {
    let (current_mem, elapsed_days) = {
        let conn = state.db.lock();
        let card = state.db.cards(&conn).get(card_id)?;
        let mem = memory_state(&card);
        let now = chrono::Utc::now().timestamp();
        let elapsed = elapsed_days_since(card.last_review, now);
        (mem, elapsed)
    };
    let scheduler = state.scheduler.lock().expect("scheduler mutex poisoned");
    scheduler.next_states(current_mem, elapsed_days)
}

#[tauri::command]
pub fn submit_review(
    state: State<'_, AppState>,
    card_id: i64,
    rating: u8,
    review_time_ms: u32,
) -> AppResult<ReviewResultDTO> {
    let rating_enum = Rating::from_u8(rating)?;
    let now = chrono::Utc::now().timestamp();

    let conn = state.db.lock();
    let card = state.db.cards(&conn).get(card_id)?;

    let current_mem = memory_state(&card);
    let elapsed_days = elapsed_days_since(card.last_review, now);

    let state_before = card.state;
    let stability_before = card.stability;
    let difficulty_before = card.difficulty;

    let outcome = {
        let scheduler = state.scheduler.lock().expect("scheduler mutex poisoned");
        scheduler.apply_review(current_mem, elapsed_days, rating_enum)?
    };

    let state_after = next_card_state(state_before, rating_enum);

    let updated_card = state.db.cards(&conn).update_after_review(
        card_id,
        state_after,
        outcome.memory.stability as f64,
        outcome.memory.difficulty as f64,
        outcome.scheduled_days as i64,
        now,
    )?;

    state.db.reviews(&conn).insert(
        NewReview {
            card_id,
            rating: rating as i64,
            state_before,
            state_after,
            stability_before,
            stability_after: outcome.memory.stability as f64,
            difficulty_before,
            difficulty_after: outcome.memory.difficulty as f64,
            elapsed_days: elapsed_days as i64,
            scheduled_days: outcome.scheduled_days as i64,
            review_time: review_time_ms as i64,
        },
        now,
    )?;

    Ok(ReviewResultDTO {
        card: updated_card,
        scheduled_days: outcome.scheduled_days,
    })
}

// ---- helpers ---------------------------------------------------------------

fn memory_state(card: &Card) -> Option<MemoryStateDTO> {
    match (card.stability, card.difficulty) {
        (Some(s), Some(d)) => Some(MemoryStateDTO {
            stability: s as f32,
            difficulty: d as f32,
        }),
        _ => None,
    }
}

/// Days between `last_review` (unix seconds, may be None) and `now` (unix
/// seconds), clamped to 0 for new cards or future timestamps.
fn elapsed_days_since(last_review: Option<i64>, now: i64) -> u32 {
    match last_review {
        Some(ts) => {
            let secs = (now - ts).max(0);
            (secs / 86_400) as u32
        }
        None => 0,
    }
}

/// New card lifecycle state, computed from the prior state and the rating.
/// Mirrors how Anki / FSRS-compatible apps move cards across buckets.
fn next_card_state(before: CardState, rating: Rating) -> CardState {
    match (before, rating) {
        // A miss on any non-new card sends it back to relearning.
        (CardState::New, Rating::Again) => CardState::Learning,
        (_, Rating::Again) => CardState::Relearning,
        // First successful answer graduates a new card into "learning".
        (CardState::New, _) => CardState::Learning,
        // Successful learning/relearning steps graduate to long-term review.
        (CardState::Learning, _) | (CardState::Relearning, _) => CardState::Review,
        (CardState::Review, _) => CardState::Review,
    }
}
