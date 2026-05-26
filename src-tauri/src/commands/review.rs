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
use crate::db::{Card, CardState, CardWithNote, NewReview, UserStats};
use crate::error::{AppError, AppResult};
use crate::fsrs::{MemoryStateDTO, NextStatesDTO, Rating};

/// Result returned by [`submit_review`]: the updated card row + the scheduled
/// interval the user just earned. The interval is also derivable from
/// `card.scheduled_days` but exposing it explicitly keeps the UI code simple.
///
/// The `user_stats` field is populated whenever the gamification update
/// succeeded; if it fails for any reason we still return `Ok` (the review
/// itself is the canonical action — a missing badge is never a deal-breaker).
/// `newly_unlocked` contains the codes of achievements unlocked by **this**
/// review so the UI can fire a celebratory toast.
#[derive(Debug, Clone, Serialize)]
pub struct ReviewResultDTO {
    pub card: Card,
    pub scheduled_days: u32,
    pub user_stats: Option<UserStats>,
    pub newly_unlocked: Vec<String>,
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
    confidence: Option<u8>,
) -> AppResult<ReviewResultDTO> {
    let rating_enum = Rating::from_u8(rating)?;
    // Validate the optional confidence in [1, 5]. None is always fine —
    // the toggle in Settings stays off by default.
    let confidence_i64 = match confidence {
        Some(v) if (1..=5).contains(&v) => Some(v as i64),
        Some(other) => {
            return Err(AppError::Validation(format!(
                "confidence must be in [1, 5] (got {other})"
            )));
        }
        None => None,
    };
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
            confidence: confidence_i64,
        },
        now,
    )?;

    // White Hat gamification — best-effort: any failure here is swallowed so
    // the user's review is always recorded.
    let correct = rating >= 2;
    let (user_stats, newly_unlocked) =
        match update_gamification(&state, &conn, now, correct, updated_card.deck_id) {
            Ok((stats, unlocked)) => (Some(stats), unlocked),
            Err(e) => {
                log::warn!("gamification update failed: {}", e);
                (None, Vec::new())
            }
        };

    Ok(ReviewResultDTO {
        card: updated_card,
        scheduled_days: outcome.scheduled_days,
        user_stats,
        newly_unlocked,
    })
}

/// Apply post-review gamification side-effects.
///
/// Returns the refreshed [`UserStats`] plus the codes of any badges unlocked
/// **by this review**. Achievement thresholds are deliberately spaced (3 / 7 /
/// 30 / 100 day streaks; 100 / 1k / 10k cumulative reviews; mastery of 100
/// burned cards) to feel earned rather than handed-out.
fn update_gamification(
    state: &AppState,
    conn: &rusqlite::Connection,
    now_ts: i64,
    correct: bool,
    deck_id: i64,
) -> AppResult<(UserStats, Vec<String>)> {
    let gamification = state.db.gamification(conn);
    let stats = gamification.update_on_review(now_ts, correct)?;

    let mastered: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM cards
             WHERE state = 'review' AND suspended = 0 AND stability >= 90.0",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    let decks_count = state.db.decks(conn).count().unwrap_or(0);

    // Collect every code that's eligible *after* this review. Order matters
    // for the toast (smaller → bigger milestones); duplicates are filtered by
    // the `UNIQUE(code)` constraint at the INSERT layer.
    let mut candidates: Vec<&'static str> = Vec::new();
    if stats.total_reviews >= 1 {
        candidates.push("first_review");
    }
    if decks_count >= 1 {
        candidates.push("first_deck");
    }
    if stats.streak_current >= 3 {
        candidates.push("streak_3");
    }
    if stats.streak_current >= 7 {
        candidates.push("streak_7");
    }
    if stats.streak_current >= 30 {
        candidates.push("streak_30");
    }
    if stats.streak_current >= 100 {
        candidates.push("streak_100");
    }
    if stats.total_reviews >= 100 {
        candidates.push("reviews_100");
    }
    if stats.total_reviews >= 1_000 {
        candidates.push("reviews_1000");
    }
    if stats.total_reviews >= 10_000 {
        candidates.push("reviews_10000");
    }
    if mastered >= 100 {
        candidates.push("master_100");
    }

    let mut unlocked = Vec::new();
    for code in candidates {
        if matches!(gamification.unlock_achievement(code, now_ts), Ok(true)) {
            unlocked.push(code.to_string());
        }
    }

    // `deck_id` is currently informational only — kept in the signature so a
    // future per-deck achievement can be added without changing callers.
    let _ = deck_id;

    Ok((stats, unlocked))
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
