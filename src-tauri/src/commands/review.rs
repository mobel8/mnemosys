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
//! Scheduling math goes through [`crate::scheduler::Scheduler`], whose
//! concrete impl is picked per-deck based on `decks.scheduler_kind`
//! (Vague 4). FSRS-6 wraps the long-lived
//! [`CardScheduler`](crate::fsrs::CardScheduler) held in [`AppState`];
//! SM-2 and Leitner are deterministic and need no global state.

use serde::Serialize;
use tauri::State;

use crate::app_state::AppState;
use crate::db::{Card, CardWithNote, NewReview, UserStats};
use crate::error::{AppError, AppResult};
use crate::fsrs::{MemoryStateDTO, NextStateDTO, NextStatesDTO};
use crate::scheduler::{self, SchedulerOutcome};

/// Result returned by [`submit_review`]: the updated card row + the scheduled
/// interval the user just earned. The interval is also derivable from
/// `card.scheduled_days` but exposing it explicitly keeps the UI code simple.
///
/// The `user_stats` field is populated whenever the gamification update
/// succeeded; if it fails for any reason we still return `Ok` (the review
/// itself is the canonical action — a missing badge is never a deal-breaker).
/// `newly_unlocked` contains the codes of achievements unlocked by **this**
/// review so the UI can fire a celebratory toast.
///
/// `review_id` is the freshly-inserted `reviews.id`. The frontend uses it
/// as the foreign key when persisting a `review_sketches` row (Vague 7).
#[derive(Debug, Clone, Serialize)]
pub struct ReviewResultDTO {
    pub card: Card,
    pub scheduled_days: u32,
    pub user_stats: Option<UserStats>,
    pub newly_unlocked: Vec<String>,
    pub review_id: i64,
}

#[tauri::command]
pub fn get_due_cards(
    state: State<'_, AppState>,
    deck_id: Option<i64>,
    limit: u32,
    // P069 — `limit` caps reviews/day (daily_review_limit); `new_limit` caps the
    // new cards that may enter the queue (daily_new_limit). None = no dedicated
    // new-card cap (legacy behaviour). The two settings were previously inert.
    new_limit: Option<u32>,
) -> AppResult<Vec<CardWithNote>> {
    let now = chrono::Utc::now().timestamp();
    let conn = state.db.lock();
    state
        .db
        .cards(&conn)
        .due_cards_with_new(deck_id, now, limit, new_limit)
}

/// Multi-deck interleaved due queue (Vague 5).
///
/// Returns up to `limit` cards drawn from the listed decks, shuffled so the
/// learner mixes contexts within one session — Rohrer & Taylor 2015 reported
/// roughly 2× retention on delayed tests vs blocked practice. `deck_ids`
/// must be non-empty; an empty vec is returned otherwise.
#[tauri::command]
pub fn get_interleaved_due_cards(
    state: State<'_, AppState>,
    deck_ids: Vec<i64>,
    limit: u32,
) -> AppResult<Vec<CardWithNote>> {
    if deck_ids.is_empty() {
        return Err(AppError::Validation(
            "deck_ids must contain at least one deck".to_string(),
        ));
    }
    if limit == 0 {
        return Err(AppError::Validation("limit must be at least 1".to_string()));
    }
    // P128: clamp the requested page so a stray huge `limit` from the client
    // can't force an oversized allocation. 500 dwarfs any realistic single
    // session yet keeps the in-memory prefetch (≤1024 rows) trivial.
    let limit = limit.min(500);
    let now = chrono::Utc::now().timestamp();
    let conn = state.db.lock();
    state
        .db
        .cards(&conn)
        .due_cards_interleaved(&deck_ids, now, limit)
}

#[tauri::command]
pub fn preview_next_states(state: State<'_, AppState>, card_id: i64) -> AppResult<NextStatesDTO> {
    let now = chrono::Utc::now().timestamp();
    let (card, kind, deck_retention) = {
        let conn = state.db.lock();
        let card = state.db.cards(&conn).get(card_id)?;
        let deck = state.db.decks(&conn).get(card.deck_id)?;
        (card, deck.scheduler_kind, deck.desired_retention as f32)
    };
    let fsrs = state.scheduler.lock().expect("scheduler mutex poisoned");
    // Honour the deck's own retention target so the preview chips match what
    // submit_review will actually schedule (P006).
    let dispatcher = scheduler::from_kind_with_retention(kind, &fsrs, deck_retention);
    let preview = dispatcher.preview(&card, now)?;
    Ok(preview_to_dto(&preview))
}

#[tauri::command]
pub fn submit_review(
    state: State<'_, AppState>,
    card_id: i64,
    rating: u8,
    review_time_ms: u32,
    confidence: Option<u8>,
    confidence_post: Option<u8>,
) -> AppResult<ReviewResultDTO> {
    // Validate both optional confidences in [1, 5]. None is always fine —
    // the toggle in Settings stays off by default. `confidence` is the
    // prospective CBM rating (before the flip, v5); `confidence_post` is the
    // retrospective rating (after the answer, v15 — Bang & Fleming 2018).
    let confidence_i64 = validate_confidence(confidence, "confidence")?;
    let confidence_post_i64 = validate_confidence(confidence_post, "confidence_post")?;
    let now = chrono::Utc::now().timestamp();

    let conn = state.db.lock();

    // P003 — wrap the whole mutation (card update + review log + JOL resolve +
    // gamification) in ONE transaction so a mid-way failure can't leave the
    // card advanced without a matching review row (or vice-versa). The repos
    // take `&Connection`; a `Transaction` derefs to `Connection`, so the same
    // accessors work against `tx`. `unchecked_transaction` only needs `&self`,
    // which is all we hold through the mutex guard.
    let tx = conn.unchecked_transaction()?;

    let card = state.db.cards(&tx).get(card_id)?;
    let deck = state.db.decks(&tx).get(card.deck_id)?;

    let state_before = card.state;
    let stability_before = card.stability;
    let difficulty_before = card.difficulty;

    let outcome = {
        let fsrs = state.scheduler.lock().expect("scheduler mutex poisoned");
        // P006 — thread the deck's own retention target into FSRS scheduling.
        let dispatcher = scheduler::from_kind_with_retention(
            deck.scheduler_kind,
            &fsrs,
            deck.desired_retention as f32,
        );
        dispatcher.next_review(&card, rating, now)?
    };

    // The interval the UI receives is `max(0, scheduled_days)` — SM-2's
    // "again" path stores 0 days (relearn now) which we surface as a 0-day
    // toast. Negative values cannot occur (each algorithm clamps).
    let scheduled_days_u32 = outcome.scheduled_days.max(0) as u32;

    // P003 — reuse the already-loaded `card`; no redundant SELECT inside the
    // transaction (update_after_review_with reads reps/lapses/last_review off
    // the passed value).
    let updated_card = state.db.cards(&tx).update_after_review_with(
        &card,
        outcome.state,
        outcome.stability,
        outcome.difficulty,
        outcome.scheduled_days,
        now,
    )?;

    let inserted_review = state.db.reviews(&tx).insert(
        NewReview {
            card_id,
            rating: rating as i64,
            state_before,
            state_after: outcome.state,
            stability_before,
            stability_after: outcome.stability,
            difficulty_before,
            difficulty_after: outcome.difficulty,
            elapsed_days: outcome.elapsed_days,
            scheduled_days: outcome.scheduled_days,
            review_time: review_time_ms as i64,
            confidence: confidence_i64,
            confidence_post: confidence_post_i64,
        },
        now,
    )?;

    // Vague 7 — best-effort: if a JOL was waiting on this card, resolve it
    // against this review's outcome. Swallow errors so a calibration write
    // failure never blocks the underlying review (the JOL row is auxiliary;
    // it lives in the same transaction but a failure here is non-fatal).
    let correct_for_jol = rating >= 3;
    if let Err(e) = state
        .db
        .metacognition(&tx)
        .resolve_prediction(card_id, correct_for_jol, now)
    {
        log::warn!("jol resolve_prediction failed: {}", e);
    }

    // White Hat gamification — best-effort: any failure here is swallowed so
    // the user's review is always recorded.
    // P055: gamification deliberately treats Hard (≥2) as « not a lapse » (the
    // learner didn't fully forget), which is a DIFFERENT signal from the FSRS
    // « recall » (≥3) used by JOL / mastery / the session summary. Named so the
    // threshold gap reads as intentional, not a bug.
    let not_a_lapse = rating >= 2;
    let (user_stats, newly_unlocked) =
        match update_gamification(&state, &tx, now, not_a_lapse, updated_card.deck_id) {
            Ok((stats, unlocked)) => (Some(stats), unlocked),
            Err(e) => {
                log::warn!("gamification update failed: {}", e);
                (None, Vec::new())
            }
        };

    // Commit the canonical mutation. Any error before this point dropped `tx`
    // unread → automatic ROLLBACK, leaving the card + review log consistent.
    tx.commit()?;

    Ok(ReviewResultDTO {
        card: updated_card,
        scheduled_days: scheduled_days_u32,
        user_stats,
        newly_unlocked,
        review_id: inserted_review.id,
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
    not_a_lapse: bool,
    deck_id: i64,
) -> AppResult<(UserStats, Vec<String>)> {
    let gamification = state.db.gamification(conn);
    let stats = gamification.update_on_review(now_ts, not_a_lapse)?;

    // P063: counting mastered cards is a full table scan. Skip it entirely once
    // the `master_100` badge is earned (achievements never un-earn), so the hot
    // review path doesn't re-scan every card on every single review.
    let master_100_unlocked = conn
        .query_row(
            "SELECT 1 FROM achievements WHERE code = 'master_100' LIMIT 1",
            [],
            |_| Ok(()),
        )
        .is_ok();
    let mastered: i64 = if master_100_unlocked {
        100
    } else {
        conn.query_row(
            "SELECT COUNT(*) FROM cards
             WHERE state = 'review' AND suspended = 0 AND stability >= 90.0",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0)
    };
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

/// Validate an optional 1..=5 confidence value, surfacing a friendly
/// `Validation` error (tagged with `field`) when it is out of range. `None`
/// is always accepted (the rating is opt-in).
fn validate_confidence(value: Option<u8>, field: &str) -> AppResult<Option<i64>> {
    match value {
        Some(v) if (1..=5).contains(&v) => Ok(Some(v as i64)),
        Some(other) => Err(AppError::Validation(format!(
            "{field} must be in [1, 5] (got {other})"
        ))),
        None => Ok(None),
    }
}

/// Translate a [`scheduler::RatingPreview`] (algorithm-agnostic) into the
/// existing [`NextStatesDTO`] shape the frontend already understands.
///
/// The DTO uses `stability` / `difficulty` floats — for SM-2 those
/// correspond to `(0.0, EF)` and for Leitner to `(0.0, box_index)`.
/// The UI doesn't care about the interpretation; it shows `interval_days`
/// only.
fn preview_to_dto(preview: &scheduler::RatingPreview) -> NextStatesDTO {
    NextStatesDTO {
        again: outcome_to_dto(&preview.again),
        hard: outcome_to_dto(&preview.hard),
        good: outcome_to_dto(&preview.good),
        easy: outcome_to_dto(&preview.easy),
    }
}

fn outcome_to_dto(o: &SchedulerOutcome) -> NextStateDTO {
    NextStateDTO {
        memory: MemoryStateDTO {
            stability: o.stability as f32,
            difficulty: o.difficulty as f32,
        },
        interval_days: o.scheduled_days as f32,
    }
}
