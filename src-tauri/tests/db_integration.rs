//! Integration tests for the DB layer.
//!
//! All tests run against an in-memory SQLite database (`Database::for_test()`)
//! so they're hermetic and fast. They exercise the contracts that downstream
//! agents rely on (decks → notes → cards cascade, FTS5 search, FSRS scheduler
//! update flow, etc.).

use chrono::{Duration, Utc};
use mnemosys_lib::db::{
    cards::CardState, decks::DeckPatch, notes::NoteTemplate, reviews::NewReview, Database,
};
use mnemosys_lib::scheduler::SchedulerKind;
use serde_json::json;

// ---- helpers ---------------------------------------------------------------

/// Returns a deck id seeded into a fresh in-memory DB.
fn fresh_db_with_deck() -> (Database, i64) {
    let db = Database::for_test();
    let conn = db.lock();
    let deck = db
        .decks(&conn)
        .create("Default", None, "#3b82f6", 0.9, None, None, None)
        .expect("create deck");
    (db.clone(), deck.id)
}

// ---- deck tests ------------------------------------------------------------

#[test]
fn create_deck_returns_deck_with_id() {
    let db = Database::for_test();
    let conn = db.lock();
    let deck = db
        .decks(&conn)
        .create("Spanish", Some("Vocab"), "#ff0000", 0.92, None, None, None)
        .expect("create deck");
    assert!(deck.id > 0);
    assert_eq!(deck.name, "Spanish");
    assert_eq!(deck.description.as_deref(), Some("Vocab"));
    assert_eq!(deck.color, "#ff0000");
    assert!((deck.desired_retention - 0.92).abs() < 1e-9);
}

#[test]
fn list_decks_alphabetical() {
    let db = Database::for_test();
    let conn = db.lock();
    let repo = db.decks(&conn);
    repo.create("Charlie", None, "#000000", 0.9, None, None, None)
        .unwrap();
    repo.create("alpha", None, "#000000", 0.9, None, None, None)
        .unwrap();
    repo.create("Bravo", None, "#000000", 0.9, None, None, None)
        .unwrap();

    let decks = repo.list().unwrap();
    let names: Vec<&str> = decks.iter().map(|d| d.name.as_str()).collect();
    assert_eq!(names, vec!["alpha", "Bravo", "Charlie"]);
}

#[test]
fn update_deck_partial() {
    let (db, deck_id) = fresh_db_with_deck();
    let conn = db.lock();
    let updated = db
        .decks(&conn)
        .update(
            deck_id,
            DeckPatch {
                name: Some("Renamed".into()),
                description: Some(Some("new description".into())),
                color: None,
                desired_retention: Some(0.85),
                language_mode: None,
                prerequisite_deck_id: None,
            },
        )
        .expect("update");
    assert_eq!(updated.name, "Renamed");
    assert_eq!(updated.description.as_deref(), Some("new description"));
    assert_eq!(updated.color, "#3b82f6"); // unchanged
    assert!((updated.desired_retention - 0.85).abs() < 1e-9);
}

#[test]
fn delete_deck_cascades_notes_and_cards() {
    let (db, deck_id) = fresh_db_with_deck();
    let conn = db.lock();

    // Add a basic note (creates 1 card)
    let note = db
        .notes(&conn)
        .create(
            deck_id,
            NoteTemplate::Basic,
            json!({ "front": "hola", "back": "hello" }),
            vec!["greetings".into()],
            None,
        )
        .expect("create note");

    let note_count_before: i64 = conn
        .query_row("SELECT COUNT(*) FROM notes", [], |r| r.get(0))
        .unwrap();
    let card_count_before: i64 = conn
        .query_row("SELECT COUNT(*) FROM cards", [], |r| r.get(0))
        .unwrap();
    assert_eq!(note_count_before, 1);
    assert_eq!(card_count_before, 1);
    assert!(note.id > 0);

    db.decks(&conn).delete(deck_id).unwrap();

    let note_count_after: i64 = conn
        .query_row("SELECT COUNT(*) FROM notes", [], |r| r.get(0))
        .unwrap();
    let card_count_after: i64 = conn
        .query_row("SELECT COUNT(*) FROM cards", [], |r| r.get(0))
        .unwrap();
    assert_eq!(note_count_after, 0, "notes should cascade-delete");
    assert_eq!(card_count_after, 0, "cards should cascade-delete");
}

// ---- note + card creation --------------------------------------------------

#[test]
fn create_note_basic_creates_1_card() {
    let (db, deck_id) = fresh_db_with_deck();
    let conn = db.lock();
    let note = db
        .notes(&conn)
        .create(
            deck_id,
            NoteTemplate::Basic,
            json!({ "front": "Q", "back": "A" }),
            vec![],
            None,
        )
        .unwrap();

    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM cards WHERE note_id = ?1",
            rusqlite::params![note.id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 1);
}

#[test]
fn create_note_basic_reverse_creates_2_cards() {
    let (db, deck_id) = fresh_db_with_deck();
    let conn = db.lock();
    let note = db
        .notes(&conn)
        .create(
            deck_id,
            NoteTemplate::BasicReverse,
            json!({ "front": "hola", "back": "hello" }),
            vec![],
            None,
        )
        .unwrap();

    let mut stmt = conn
        .prepare("SELECT card_ord FROM cards WHERE note_id = ?1 ORDER BY card_ord ASC")
        .unwrap();
    let ords: Vec<i64> = stmt
        .query_map(rusqlite::params![note.id], |r| r.get::<_, i64>(0))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    assert_eq!(ords, vec![0, 1]);
}

#[test]
fn create_note_cloze_creates_n_cards() {
    let (db, deck_id) = fresh_db_with_deck();
    let conn = db.lock();
    let note = db
        .notes(&conn)
        .create(
            deck_id,
            NoteTemplate::Cloze,
            json!({
                "text": "The {{c1::capital}} of {{c2::France}} is {{c3::Paris}}"
            }),
            vec![],
            None,
        )
        .unwrap();

    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM cards WHERE note_id = ?1",
            rusqlite::params![note.id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 3, "expected one card per unique cloze index");
}

// ---- FTS5 search -----------------------------------------------------------

#[test]
fn fts_search_returns_matching_notes() {
    let (db, deck_id) = fresh_db_with_deck();
    let conn = db.lock();
    db.notes(&conn)
        .create(
            deck_id,
            NoteTemplate::Basic,
            json!({ "front": "hola mundo", "back": "hello world" }),
            vec!["spanish".into()],
            None,
        )
        .unwrap();
    db.notes(&conn)
        .create(
            deck_id,
            NoteTemplate::Basic,
            json!({ "front": "adios", "back": "goodbye" }),
            vec!["spanish".into()],
            None,
        )
        .unwrap();

    let hits = db.notes(&conn).search("hola", 10).unwrap();
    assert_eq!(hits.len(), 1);
    assert!(hits[0].fields.to_string().contains("hola"));

    let hits_all = db.notes(&conn).search("spanish", 10).unwrap();
    assert_eq!(hits_all.len(), 2);
}

// ---- due-card scheduling ---------------------------------------------------

#[test]
fn due_cards_excludes_suspended() {
    let (db, deck_id) = fresh_db_with_deck();
    let conn = db.lock();
    let note = db
        .notes(&conn)
        .create(
            deck_id,
            NoteTemplate::Basic,
            json!({ "front": "Q", "back": "A" }),
            vec![],
            None,
        )
        .unwrap();
    // The note's lone card lives at id=1 (fresh DB).
    let card = db
        .cards(&conn)
        .list_in_deck(deck_id, 10, 0)
        .unwrap()
        .pop()
        .unwrap()
        .card;
    assert_eq!(card.note_id, note.id);

    // Move into "review" with a due time in the past.
    let now = 1_700_000_000_i64;
    db.cards(&conn)
        .update_after_review(card.id, CardState::Review, 5.0, 5.0, -1, now)
        .unwrap();

    // Should appear as due.
    let due = db.cards(&conn).due_cards(Some(deck_id), now, 10).unwrap();
    assert_eq!(due.len(), 1);

    // Suspend → disappears.
    db.cards(&conn).suspend(card.id, true).unwrap();
    let due_after = db.cards(&conn).due_cards(Some(deck_id), now, 10).unwrap();
    assert_eq!(due_after.len(), 0);
}

// ---- reviews ---------------------------------------------------------------

#[test]
fn insert_review_returns_review_with_id() {
    let (db, deck_id) = fresh_db_with_deck();
    let conn = db.lock();
    db.notes(&conn)
        .create(
            deck_id,
            NoteTemplate::Basic,
            json!({ "front": "Q", "back": "A" }),
            vec![],
            None,
        )
        .unwrap();
    let card_id = db
        .cards(&conn)
        .list_in_deck(deck_id, 10, 0)
        .unwrap()
        .pop()
        .unwrap()
        .card
        .id;

    let now = 1_700_000_000_i64;
    let review = db
        .reviews(&conn)
        .insert(
            NewReview {
                card_id,
                rating: 3,
                state_before: CardState::New,
                state_after: CardState::Learning,
                stability_before: None,
                stability_after: 1.5,
                difficulty_before: None,
                difficulty_after: 5.0,
                elapsed_days: 0,
                scheduled_days: 1,
                review_time: 4_500,
                confidence: None,
                confidence_post: None,
            },
            now,
        )
        .unwrap();

    assert!(review.id > 0);
    assert_eq!(review.card_id, card_id);
    assert_eq!(review.rating, 3);
    assert!((review.stability_after - 1.5).abs() < 1e-9);
    assert!(
        review.confidence.is_none(),
        "default confidence must round-trip as None"
    );
}

/// v5: confidence ratings round-trip through the reviews table and the
/// repo when the toggle is on (CBM — Gardner-Medwin UCL).
#[test]
fn insert_review_persists_confidence_in_1_to_5() {
    let (db, deck_id) = fresh_db_with_deck();
    let conn = db.lock();
    db.notes(&conn)
        .create(
            deck_id,
            NoteTemplate::Basic,
            json!({ "front": "Q", "back": "A" }),
            vec![],
            None,
        )
        .unwrap();
    let card_id = db
        .cards(&conn)
        .list_in_deck(deck_id, 10, 0)
        .unwrap()
        .pop()
        .unwrap()
        .card
        .id;

    let now = 1_700_000_001_i64;
    let review = db
        .reviews(&conn)
        .insert(
            NewReview {
                card_id,
                rating: 3,
                state_before: CardState::New,
                state_after: CardState::Learning,
                stability_before: None,
                stability_after: 2.0,
                difficulty_before: None,
                difficulty_after: 5.0,
                elapsed_days: 0,
                scheduled_days: 1,
                review_time: 2_000,
                confidence: Some(4),
                confidence_post: None,
            },
            now,
        )
        .unwrap();

    assert_eq!(review.confidence, Some(4));

    // Read-through: list_for_card must also surface the value.
    let history = db.reviews(&conn).list_for_card(card_id).unwrap();
    assert_eq!(history.len(), 1);
    assert_eq!(history[0].confidence, Some(4));
}

// ---- extras ---------------------------------------------------------------

#[test]
fn deck_stats_counts_by_state() {
    let (db, deck_id) = fresh_db_with_deck();
    let conn = db.lock();
    // 2 brand-new cards
    db.notes(&conn)
        .create(
            deck_id,
            NoteTemplate::BasicReverse,
            json!({ "front": "Q", "back": "A" }),
            vec![],
            None,
        )
        .unwrap();
    let stats = db.decks(&conn).stats(deck_id).unwrap();
    assert_eq!(stats.total_cards, 2);
    assert_eq!(stats.new_cards, 2);
    assert_eq!(stats.review_cards, 0);
    assert_eq!(stats.learning_cards, 0);
    assert_eq!(stats.due_today, 0);
}

#[test]
fn reset_card_clears_fsrs_state_and_preserves_reviews() {
    let (db, deck_id) = fresh_db_with_deck();
    let conn = db.lock();
    db.notes(&conn)
        .create(
            deck_id,
            NoteTemplate::Basic,
            json!({ "front": "Q", "back": "A" }),
            vec![],
            None,
        )
        .unwrap();
    let card_id = db
        .cards(&conn)
        .list_in_deck(deck_id, 10, 0)
        .unwrap()
        .pop()
        .unwrap()
        .card
        .id;

    // Simulate a single review pass so the card has non-zero FSRS state.
    let now = 1_700_000_000_i64;
    db.cards(&conn)
        .update_after_review(card_id, CardState::Review, 5.0, 5.0, 5, now)
        .unwrap();
    db.reviews(&conn)
        .insert(
            NewReview {
                card_id,
                rating: 3,
                state_before: CardState::New,
                state_after: CardState::Review,
                stability_before: None,
                stability_after: 5.0,
                difficulty_before: None,
                difficulty_after: 5.0,
                elapsed_days: 0,
                scheduled_days: 5,
                review_time: 1_500,
                confidence: None,
                confidence_post: None,
            },
            now,
        )
        .unwrap();

    // Sanity check: card now has scheduling fields populated.
    let before = db.cards(&conn).get(card_id).unwrap();
    assert_eq!(before.state, CardState::Review);
    assert!(before.stability.is_some());
    assert_eq!(before.scheduled_days, 5);
    assert_eq!(before.reps, 1);

    // Reset.
    let after = db.cards(&conn).reset(card_id).unwrap();
    assert_eq!(after.state, CardState::New);
    assert!(after.stability.is_none(), "stability must be cleared");
    assert!(after.difficulty.is_none(), "difficulty must be cleared");
    assert!(after.last_review.is_none(), "last_review must be cleared");
    assert!(after.next_review.is_none(), "next_review must be cleared");
    assert_eq!(after.elapsed_days, 0);
    assert_eq!(after.scheduled_days, 0);
    assert_eq!(after.reps, 0);
    assert_eq!(after.lapses, 0);

    // Reviews history must survive — that's the whole point of reset vs delete.
    let reviews_after = db.reviews(&conn).list_for_card(card_id).unwrap();
    assert_eq!(reviews_after.len(), 1);
    assert_eq!(reviews_after[0].card_id, card_id);
}

// ---- gamification (Vague 1) -----------------------------------------------

#[test]
fn user_stats_singleton_is_seeded_on_init() {
    let db = Database::for_test();
    let conn = db.lock();
    let stats = db.gamification(&conn).get_user_stats().unwrap();
    assert_eq!(stats.streak_current, 0);
    assert_eq!(stats.streak_best, 0);
    assert_eq!(stats.total_reviews, 0);
    assert_eq!(stats.total_correct, 0);
    assert!(stats.last_review_date.is_none());
    // Freeze counter is lazily initialised on the first review call; the
    // singleton row defaults to 2 / NULL until then.
    assert_eq!(stats.freeze_remaining, 2);
}

#[test]
fn streak_increments_on_new_day() {
    let db = Database::for_test();
    let conn = db.lock();
    let now = Utc::now();
    let yesterday = now - Duration::days(1);
    let two_days_ago = now - Duration::days(2);

    let s = db
        .gamification(&conn)
        .update_on_review(two_days_ago.timestamp(), true)
        .unwrap();
    assert_eq!(s.streak_current, 1);
    let s = db
        .gamification(&conn)
        .update_on_review(yesterday.timestamp(), true)
        .unwrap();
    assert_eq!(s.streak_current, 2);
    let s = db
        .gamification(&conn)
        .update_on_review(now.timestamp(), true)
        .unwrap();
    assert_eq!(s.streak_current, 3);
    assert_eq!(s.streak_best, 3);
    assert_eq!(s.total_reviews, 3);
    assert_eq!(s.total_correct, 3);
}

#[test]
fn streak_resets_on_gap_more_than_one_day() {
    let db = Database::for_test();
    let conn = db.lock();
    let now = Utc::now();

    // Prime: a single review primes streak=1, freeze=2.
    let seven_days_ago = now - Duration::days(7);
    db.gamification(&conn)
        .update_on_review(seven_days_ago.timestamp(), true)
        .unwrap();

    // Today is 7 days after — gap is far above the 2-day freeze rescue
    // window. Even with both freezes available, the streak must reset.
    let s = db
        .gamification(&conn)
        .update_on_review(now.timestamp(), true)
        .unwrap();
    assert_eq!(s.streak_current, 1, "huge gap must reset the streak");
    // Freezes are preserved (the rescue path didn't fire — gap > 2).
    assert_eq!(s.freeze_remaining, 2);
}

#[test]
fn streak_uses_freeze_when_available() {
    let db = Database::for_test();
    let conn = db.lock();
    let now = Utc::now();
    let two_days_ago = now - Duration::days(2);

    // First review primes the streak at 1.
    let s = db
        .gamification(&conn)
        .update_on_review(two_days_ago.timestamp(), true)
        .unwrap();
    assert_eq!(s.streak_current, 1);
    assert_eq!(s.freeze_remaining, 2);

    // Skip a day — gap is 2 → consume one freeze, streak grows to 2.
    let s = db
        .gamification(&conn)
        .update_on_review(now.timestamp(), true)
        .unwrap();
    assert_eq!(s.streak_current, 2);
    assert_eq!(s.freeze_remaining, 1);
}

#[test]
fn freeze_resets_at_new_month() {
    let db = Database::for_test();
    let conn = db.lock();
    let now = Utc::now();

    // Burn one freeze in the current month.
    db.gamification(&conn)
        .update_on_review(now.timestamp(), true)
        .unwrap();
    db.gamification(&conn).use_freeze().unwrap();
    let stats = db.gamification(&conn).get_user_stats().unwrap();
    assert_eq!(stats.freeze_remaining, 1);

    // Rewind `freeze_month` to last month so the next call triggers a reset.
    let prev_month = (now - Duration::days(45)).format("%Y-%m").to_string();
    conn.execute(
        "UPDATE user_stats SET freeze_month = ?1 WHERE id = 1",
        rusqlite::params![prev_month],
    )
    .unwrap();

    // Any read that goes through update_on_review or use_freeze re-runs the
    // monthly refresh.
    let stats = db
        .gamification(&conn)
        .update_on_review(now.timestamp(), true)
        .unwrap();
    assert_eq!(stats.freeze_remaining, 2, "freezes should reset to default");
}

#[test]
fn unlock_achievement_is_idempotent() {
    let db = Database::for_test();
    let conn = db.lock();
    let now = Utc::now().timestamp();
    let repo = db.gamification(&conn);

    assert!(repo.unlock_achievement("first_review", now).unwrap());
    assert!(!repo.unlock_achievement("first_review", now).unwrap());
    let list = repo.list_achievements().unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].code, "first_review");
}

#[test]
fn deck_mastery_distribution_buckets_by_stability() {
    let (db, deck_id) = fresh_db_with_deck();
    let conn = db.lock();

    // Seed five basic notes (one card each).
    for i in 0..5 {
        db.notes(&conn)
            .create(
                deck_id,
                NoteTemplate::Basic,
                json!({ "front": format!("Q{}", i), "back": "A" }),
                vec![],
                None,
            )
            .unwrap();
    }
    let cards = db.cards(&conn).list_in_deck(deck_id, 10, 0).unwrap();
    assert_eq!(cards.len(), 5);

    let now = Utc::now().timestamp();
    // Card 0: apprentice (still new — no review applied).
    // Card 1: guru (stability=10)
    db.cards(&conn)
        .update_after_review(cards[1].card.id, CardState::Review, 10.0, 5.0, 10, now)
        .unwrap();
    // Card 2: master (stability=60)
    db.cards(&conn)
        .update_after_review(cards[2].card.id, CardState::Review, 60.0, 5.0, 60, now)
        .unwrap();
    // Card 3: enlightened (stability=120)
    db.cards(&conn)
        .update_after_review(cards[3].card.id, CardState::Review, 120.0, 5.0, 120, now)
        .unwrap();
    // Card 4: burned (stability=200)
    db.cards(&conn)
        .update_after_review(cards[4].card.id, CardState::Review, 200.0, 5.0, 200, now)
        .unwrap();

    let mastery = db.decks(&conn).mastery(deck_id).unwrap();
    assert_eq!(mastery.apprentice, 1);
    assert_eq!(mastery.guru, 1);
    assert_eq!(mastery.master, 1);
    assert_eq!(mastery.enlightened, 1);
    assert_eq!(mastery.burned, 1);
    assert_eq!(mastery.total(), 5);
}

// ---- scheduler kind (FSRS-6 only since v0.11) -------------------------------

#[test]
fn deck_scheduler_kind_defaults_to_fsrs6() {
    let (db, deck_id) = fresh_db_with_deck();
    let conn = db.lock();
    let deck = db.decks(&conn).get(deck_id).unwrap();
    assert_eq!(deck.scheduler_kind, SchedulerKind::Fsrs6);
}

/// v0.11 — FSRS-6 is the only scheduler: a caller asking for a legacy
/// algorithm at create time is ignored, the deck is persisted as `'fsrs6'`.
#[test]
fn create_deck_ignores_requested_scheduler_kind() {
    let db = Database::for_test();
    let conn = db.lock();

    let deck = db
        .decks(&conn)
        .create(
            "SM2 Deck",
            None,
            "#3b82f6",
            0.9,
            Some(SchedulerKind::Sm2),
            None,
            None,
        )
        .expect("create");
    assert_eq!(deck.scheduler_kind, SchedulerKind::Fsrs6);

    let refreshed = db.decks(&conn).get(deck.id).unwrap();
    assert_eq!(refreshed.scheduler_kind, SchedulerKind::Fsrs6);

    // list() must also return the forced kind.
    let listed = db
        .decks(&conn)
        .list()
        .unwrap()
        .into_iter()
        .find(|d| d.id == deck.id)
        .unwrap();
    assert_eq!(listed.scheduler_kind, SchedulerKind::Fsrs6);
}

// ---- Vague 5 — interleaved review ------------------------------------------

/// Spin up a fresh DB with two decks, each carrying `cards_per_deck` cards
/// that are all due in the past. Returns `(db, deck_a_id, deck_b_id)`.
fn fresh_db_with_two_decks_of_due_cards(cards_per_deck: usize) -> (Database, i64, i64) {
    let db = Database::for_test();
    let now = 1_700_000_000_i64;

    let (deck_a, deck_b) = {
        let conn = db.lock();
        let deck_a = db
            .decks(&conn)
            .create("Alpha", None, "#3b82f6", 0.9, None, None, None)
            .unwrap();
        let deck_b = db
            .decks(&conn)
            .create("Bravo", None, "#10b981", 0.9, None, None, None)
            .unwrap();

        for deck in [&deck_a, &deck_b] {
            for i in 0..cards_per_deck {
                let note = db
                    .notes(&conn)
                    .create(
                        deck.id,
                        NoteTemplate::Basic,
                        json!({
                            "front": format!("{}-Q{}", deck.name, i),
                            "back":  format!("{}-A{}", deck.name, i),
                        }),
                        vec![],
                        None,
                    )
                    .unwrap();
                let card_id = db
                    .cards(&conn)
                    .list_in_deck(deck.id, 100, 0)
                    .unwrap()
                    .into_iter()
                    .find(|cn| cn.card.note_id == note.id)
                    .unwrap()
                    .card
                    .id;
                db.cards(&conn)
                    .update_after_review(card_id, CardState::Review, 5.0, 5.0, -1, now)
                    .unwrap();
            }
        }
        (deck_a, deck_b)
    };

    (db, deck_a.id, deck_b.id)
}

#[test]
fn interleaved_due_cards_returns_from_all_specified_decks() {
    let (db, deck_a_id, deck_b_id) = fresh_db_with_two_decks_of_due_cards(5);
    let conn = db.lock();
    let now = 1_700_000_000_i64;

    let queue = db
        .cards(&conn)
        .due_cards_interleaved(&[deck_a_id, deck_b_id], now, 20)
        .expect("interleaved fetch");

    // Both decks should be represented (5 + 5 = 10 due cards exist).
    assert_eq!(queue.len(), 10);
    let mut from_a = 0_usize;
    let mut from_b = 0_usize;
    for c in &queue {
        if c.card.deck_id == deck_a_id {
            from_a += 1;
        } else if c.card.deck_id == deck_b_id {
            from_b += 1;
        }
    }
    assert_eq!(from_a, 5);
    assert_eq!(from_b, 5);
}

#[test]
fn interleaved_due_cards_respects_limit() {
    let (db, deck_a_id, deck_b_id) = fresh_db_with_two_decks_of_due_cards(10);
    let conn = db.lock();
    let now = 1_700_000_000_i64;

    let queue = db
        .cards(&conn)
        .due_cards_interleaved(&[deck_a_id, deck_b_id], now, 7)
        .expect("interleaved fetch");
    assert_eq!(queue.len(), 7);

    // An empty deck list errors out at the command layer; the DB layer
    // simply returns an empty vec so callers can defend in depth.
    let empty = db
        .cards(&conn)
        .due_cards_interleaved(&[], now, 7)
        .expect("empty deck list");
    assert!(empty.is_empty());

    // limit=0 → empty queue too.
    let zero = db
        .cards(&conn)
        .due_cards_interleaved(&[deck_a_id], now, 0)
        .expect("zero limit");
    assert!(zero.is_empty());
}

#[test]
fn interleaved_due_cards_shuffles_order() {
    // 20 cards across 2 decks should produce different orderings across
    // a few runs. We sample N=5 calls and assert that at least one
    // produces a distinct ID sequence from the first one — a tolerant
    // check that catches the « shuffle absent » regression without
    // depending on a specific PRNG seed.
    let (db, deck_a_id, deck_b_id) = fresh_db_with_two_decks_of_due_cards(10);
    let conn = db.lock();
    let now = 1_700_000_000_i64;

    let first: Vec<i64> = db
        .cards(&conn)
        .due_cards_interleaved(&[deck_a_id, deck_b_id], now, 20)
        .unwrap()
        .into_iter()
        .map(|cn| cn.card.id)
        .collect();
    assert_eq!(first.len(), 20);

    let mut saw_different_order = false;
    for _ in 0..5 {
        // Sleep a sub-millisecond gap so the SystemTime-seeded shuffle
        // doesn't reuse the same nanosecond. The shuffle also mixes the
        // slice length into the seed, but two same-size shuffles within
        // the same ns would still collide — hence the tiny jitter.
        std::thread::sleep(std::time::Duration::from_millis(2));
        let next: Vec<i64> = db
            .cards(&conn)
            .due_cards_interleaved(&[deck_a_id, deck_b_id], now, 20)
            .unwrap()
            .into_iter()
            .map(|cn| cn.card.id)
            .collect();
        if next != first {
            saw_different_order = true;
            break;
        }
    }
    assert!(
        saw_different_order,
        "interleaved queue order never changed across 5 calls — shuffle missing?"
    );
}

// ---- Vague 7 — sketches ------------------------------------------------------

/// Spin up a deck + a basic card + a review row, returning (card_id, review_id).
fn seed_card_with_review(db: &Database, deck_id: i64) -> (i64, i64) {
    let conn = db.lock();
    db.notes(&conn)
        .create(
            deck_id,
            NoteTemplate::Basic,
            json!({ "front": "Q", "back": "A" }),
            vec![],
            None,
        )
        .unwrap();
    let card_id = db
        .cards(&conn)
        .list_in_deck(deck_id, 10, 0)
        .unwrap()
        .pop()
        .unwrap()
        .card
        .id;
    let review = db
        .reviews(&conn)
        .insert(
            NewReview {
                card_id,
                rating: 3,
                state_before: CardState::New,
                state_after: CardState::Review,
                stability_before: None,
                stability_after: 5.0,
                difficulty_before: None,
                difficulty_after: 5.0,
                elapsed_days: 0,
                scheduled_days: 5,
                review_time: 1_000,
                confidence: None,
                confidence_post: None,
            },
            1_700_000_000,
        )
        .unwrap();
    (card_id, review.id)
}

#[test]
fn sketch_round_trip() {
    let (db, deck_id) = fresh_db_with_deck();
    let (card_id, review_id) = seed_card_with_review(&db, deck_id);
    let conn = db.lock();
    let s = db
        .sketches(&conn)
        .insert(
            review_id,
            card_id,
            "data:image/png;base64,AAAA",
            1_700_000_100,
        )
        .expect("insert");
    assert_eq!(s.card_id, card_id);
    let listed = db.sketches(&conn).get_for_card(card_id, 5).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].sketch_data, "data:image/png;base64,AAAA");
    assert_eq!(listed[0].review_id, review_id);
}

#[test]
fn sketch_deleted_with_card_cascade() {
    let (db, deck_id) = fresh_db_with_deck();
    let (card_id, review_id) = seed_card_with_review(&db, deck_id);
    {
        let conn = db.lock();
        db.sketches(&conn)
            .insert(
                review_id,
                card_id,
                "data:image/png;base64,XYZ",
                1_700_000_000,
            )
            .unwrap();
        // Sanity: row is there.
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM review_sketches", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);
    }
    // Deleting the parent card must cascade and drop the sketch row too.
    {
        let conn = db.lock();
        conn.execute(
            "DELETE FROM cards WHERE id = ?1",
            rusqlite::params![card_id],
        )
        .unwrap();
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM review_sketches", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0, "review_sketches must cascade on card delete");
    }
}

#[test]
fn create_sentence_note_creates_2_cards() {
    let (db, deck_id) = fresh_db_with_deck();
    let conn = db.lock();
    let note = db
        .notes(&conn)
        .create(
            deck_id,
            NoteTemplate::Bidirectional,
            json!({ "source": "学校", "target": "école", "hint": "le bâtiment" }),
            vec![],
            None,
        )
        .expect("create bidirectional note");
    assert_eq!(note.template, NoteTemplate::Bidirectional);

    let ords: Vec<i64> = {
        let mut stmt = conn
            .prepare("SELECT card_ord FROM cards WHERE note_id = ?1 ORDER BY card_ord ASC")
            .unwrap();
        stmt.query_map([note.id], |r| r.get::<_, i64>(0))
            .unwrap()
            .map(Result::unwrap)
            .collect()
    };
    assert_eq!(ords, vec![0, 1], "bidirectional → 2 cards (L2→L1, L1→L2)");

    // The one-card sentence variant produces a single card.
    let single = db
        .notes(&conn)
        .create(
            deck_id,
            NoteTemplate::Sentence,
            json!({ "source": "ありがとう", "target": "merci" }),
            vec![],
            None,
        )
        .expect("create sentence note");
    let single_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM cards WHERE note_id = ?1",
            [single.id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(single_count, 1, "sentence → 1 card (L2→L1 only)");
}

/// Both language templates reject a missing or blank `source` / `target`.
#[test]
fn sentence_requires_source_and_target() {
    let (db, deck_id) = fresh_db_with_deck();
    let conn = db.lock();

    // Missing `target`.
    let err = db
        .notes(&conn)
        .create(
            deck_id,
            NoteTemplate::Sentence,
            json!({ "source": "hola" }),
            vec![],
            None,
        )
        .unwrap_err();
    assert!(matches!(err, mnemosys_lib::error::AppError::Validation(_)));

    // Blank `source` (whitespace only).
    let err = db
        .notes(&conn)
        .create(
            deck_id,
            NoteTemplate::Bidirectional,
            json!({ "source": "   ", "target": "hello" }),
            vec![],
            None,
        )
        .unwrap_err();
    assert!(matches!(err, mnemosys_lib::error::AppError::Validation(_)));
}

/// `language_mode` round-trips through create + update on a deck.
#[test]
fn deck_language_mode_persists() {
    let db = Database::for_test();
    let conn = db.lock();

    // create with a language code
    let deck = db
        .decks(&conn)
        .create("Japonais", None, "#3b82f6", 0.9, None, Some("ja"), None)
        .expect("create language deck");
    assert_eq!(deck.language_mode.as_deref(), Some("ja"));

    // a plain deck defaults to None
    let plain = db
        .decks(&conn)
        .create("Maths", None, "#3b82f6", 0.9, None, None, None)
        .expect("create plain deck");
    assert_eq!(plain.language_mode, None);

    // update: switch the code
    let patched = db
        .decks(&conn)
        .update(
            deck.id,
            DeckPatch {
                language_mode: Some(Some("en".to_string())),
                ..Default::default()
            },
        )
        .expect("update language_mode");
    assert_eq!(patched.language_mode.as_deref(), Some("en"));

    // update: clear it back to None
    let cleared = db
        .decks(&conn)
        .update(
            deck.id,
            DeckPatch {
                language_mode: Some(None),
                ..Default::default()
            },
        )
        .expect("clear language_mode");
    assert_eq!(cleared.language_mode, None);
}

/// `frequency_coverage` buckets a deck's notes by their `frequency_band`,
/// folding NULL bands into `untagged`. The six counts sum to the deck total.
#[test]
fn frequency_coverage_counts_by_tag() {
    let (db, deck_id) = fresh_db_with_deck();
    let conn = db.lock();

    let mk = |band: Option<&str>, n: usize| {
        for i in 0..n {
            db.notes(&conn)
                .create(
                    deck_id,
                    NoteTemplate::Basic,
                    json!({ "front": format!("q{}-{:?}", i, band), "back": "a" }),
                    vec![],
                    band.map(str::to_string),
                )
                .unwrap();
        }
    };
    mk(Some("top_100"), 3);
    mk(Some("top_1k"), 2);
    mk(Some("beyond"), 1);
    mk(None, 4);

    let cov = db.notes(&conn).frequency_coverage(deck_id).unwrap();
    assert_eq!(cov.top_100, 3);
    assert_eq!(cov.top_1k, 2);
    assert_eq!(cov.top_5k, 0);
    assert_eq!(cov.top_10k, 0);
    assert_eq!(cov.beyond, 1);
    assert_eq!(cov.untagged, 4);

    let total = cov.top_100 + cov.top_1k + cov.top_5k + cov.top_10k + cov.beyond + cov.untagged;
    assert_eq!(total, db.notes(&conn).count_in_deck(deck_id).unwrap());
}

// ---- Vague 14: Modes disciplinaires ----------------------------------------

/// An `IllnessScript` note materialises a single card (condition → sections).
#[test]
fn create_illness_script_creates_1_card() {
    let (db, deck_id) = fresh_db_with_deck();
    let conn = db.lock();
    let note = db
        .notes(&conn)
        .create(
            deck_id,
            NoteTemplate::IllnessScript,
            json!({
                "condition": "Infarctus du myocarde",
                "epidemiology": "Homme > 50 ans, tabac, HTA",
                "pathophysiology": "Rupture de plaque d'athérome",
                "clinical": "Douleur thoracique constrictive irradiant au bras gauche",
                "management": "Reperfusion en urgence (angioplastie)"
            }),
            vec![],
            None,
        )
        .expect("create illness script note");
    assert_eq!(note.template, NoteTemplate::IllnessScript);

    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM cards WHERE note_id = ?1",
            rusqlite::params![note.id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 1, "illness script → 1 card");

    // A condition with a single section filled is also valid.
    let minimal = db
        .notes(&conn)
        .create(
            deck_id,
            NoteTemplate::IllnessScript,
            json!({ "condition": "Migraine", "clinical": "Céphalée pulsatile unilatérale" }),
            vec![],
            None,
        )
        .expect("create minimal illness script");
    let minimal_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM cards WHERE note_id = ?1",
            rusqlite::params![minimal.id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(minimal_count, 1);
}

/// The illness script rejects a missing/blank `condition`, and a `condition`
/// with no clinical section filled.
#[test]
fn illness_script_requires_condition() {
    let (db, deck_id) = fresh_db_with_deck();
    let conn = db.lock();

    // Missing `condition` entirely.
    let err = db
        .notes(&conn)
        .create(
            deck_id,
            NoteTemplate::IllnessScript,
            json!({ "clinical": "Fièvre" }),
            vec![],
            None,
        )
        .unwrap_err();
    assert!(matches!(err, mnemosys_lib::error::AppError::Validation(_)));

    // Blank `condition` (whitespace only).
    let err = db
        .notes(&conn)
        .create(
            deck_id,
            NoteTemplate::IllnessScript,
            json!({ "condition": "   ", "clinical": "Fièvre" }),
            vec![],
            None,
        )
        .unwrap_err();
    assert!(matches!(err, mnemosys_lib::error::AppError::Validation(_)));

    // Condition present but every section empty → no verso content.
    let err = db
        .notes(&conn)
        .create(
            deck_id,
            NoteTemplate::IllnessScript,
            json!({ "condition": "Asthme" }),
            vec![],
            None,
        )
        .unwrap_err();
    assert!(matches!(err, mnemosys_lib::error::AppError::Validation(_)));
}

/// A `Refutation` note materialises a single card (misconception → correction).
#[test]
fn create_refutation_creates_1_card() {
    let (db, deck_id) = fresh_db_with_deck();
    let conn = db.lock();
    let note = db
        .notes(&conn)
        .create(
            deck_id,
            NoteTemplate::Refutation,
            json!({
                "misconception": "Les saisons sont dues à la distance Terre-Soleil.",
                "correct": "Les saisons sont dues à l'inclinaison de l'axe terrestre.",
                "explanation": "L'orbite est quasi circulaire ; c'est l'angle d'incidence des rayons qui varie."
            }),
            vec![],
            None,
        )
        .expect("create refutation note");
    assert_eq!(note.template, NoteTemplate::Refutation);

    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM cards WHERE note_id = ?1",
            rusqlite::params![note.id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 1, "refutation → 1 card");

    // `explanation` is optional.
    let no_expl = db
        .notes(&conn)
        .create(
            deck_id,
            NoteTemplate::Refutation,
            json!({
                "misconception": "Le verre est un solide qui coule lentement.",
                "correct": "Le verre est un solide amorphe stable."
            }),
            vec![],
            None,
        )
        .expect("create refutation without explanation");
    let no_expl_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM cards WHERE note_id = ?1",
            rusqlite::params![no_expl.id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(no_expl_count, 1);
}

/// The refutation card requires both `misconception` and `correct`.
#[test]
fn refutation_requires_misconception_and_correct() {
    let (db, deck_id) = fresh_db_with_deck();
    let conn = db.lock();

    // Missing `correct`.
    let err = db
        .notes(&conn)
        .create(
            deck_id,
            NoteTemplate::Refutation,
            json!({ "misconception": "La foudre ne frappe jamais deux fois au même endroit." }),
            vec![],
            None,
        )
        .unwrap_err();
    assert!(matches!(err, mnemosys_lib::error::AppError::Validation(_)));

    // Missing `misconception`.
    let err = db
        .notes(&conn)
        .create(
            deck_id,
            NoteTemplate::Refutation,
            json!({ "correct": "La foudre peut frapper plusieurs fois le même point." }),
            vec![],
            None,
        )
        .unwrap_err();
    assert!(matches!(err, mnemosys_lib::error::AppError::Validation(_)));

    // Blank `correct` (whitespace only).
    let err = db
        .notes(&conn)
        .create(
            deck_id,
            NoteTemplate::Refutation,
            json!({ "misconception": "Idée fausse", "correct": "   " }),
            vec![],
            None,
        )
        .unwrap_err();
    assert!(matches!(err, mnemosys_lib::error::AppError::Validation(_)));
}
