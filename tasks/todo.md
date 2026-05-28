# V15 — Maths Worked Example + Mastery Gating + Two-step confidence

DB v12 -> v13 (single migration doing 3 things).

## Migration v13 (schema_v13.sql) — THE PITFALL
- [ ] Rebuild `notes` (12-step recipe, mirror v12) adding `'worked_example'` to CHECK.
      Preserve ALL columns: id, deck_id, template, fields, tags, created_at, updated_at,
      remote_id, frequency_band. Recreate idx_notes_remote_id + idx_notes_freq + FTS5 + triggers.
- [ ] `ALTER TABLE decks ADD COLUMN prerequisite_deck_id INTEGER REFERENCES decks(id)` (plain, nullable).
- [ ] `ALTER TABLE reviews ADD COLUMN confidence_post INTEGER` (plain, nullable, 1-5).
- [ ] migrations.rs: CURRENT_VERSION = 13, SCHEMA_V13 include_str!, apply guard `if current < 13`.

## Feature 1 — Faded Worked Example
- [ ] notes.rs: enum `WorkedExample` + as_str/from_str `"worked_example"`.
- [ ] validate_fields: problem (req str), steps (array >=1 non-empty str), answer (req str).
- [ ] ords_for_template -> vec![0].
- [ ] doc comment block.
- [ ] tauri.ts: add to NoteTemplate union + WorkedExampleFields interface.
- [ ] NoteEditor.tsx: "Maths" tab (Sigma icon), problem input + dynamic steps list + answer.
- [ ] ReviewCard.tsx: worked_example recto=problem; verso reveals steps one-by-one then answer.
- [ ] ReviewSession getCardFront: worked_example -> problem.
- [ ] Tests: create_worked_example_creates_1_card, worked_example_requires_problem_and_answer.

## Feature 2 — Mastery Gating
- [ ] decks.rs: Deck.prerequisite_deck_id + DeckPatch.prerequisite_deck_id (double Option).
      create() gains 7th arg prerequisite_deck_id. row_to_deck reads col 9.
      update() handles patch field. SELECTs add prerequisite_deck_id.
- [ ] decks.rs: MasteryStatus struct + mastery_status(deck_id) method.
      mastered = retention(30d, deck) >= 0.9 AND >= 20 reviews. unlocked = prereq None OR prereq mastered.
- [ ] commands/decks.rs: get_deck_mastery_status command. Fix create_deck 7th arg. lib.rs register.
- [ ] Fix 6 other DeckRepo::create call-sites (append None): apkg, demo, io, notes tests x2, sync tests x3.
- [ ] tauri.ts: Deck/DeckPatch + MasteryStatus + api.decks.masteryStatus + create() prerequisiteDeckId.
- [ ] queries.ts: queryKeys.deckMasteryStatus + useDeckMasteryStatus + invalidate on review/update.
- [ ] DeckCard.tsx: lock icon when !unlocked, disable Étudier with tooltip.
- [ ] Create/EditDeckDialog: "Deck prérequis" dropdown (other decks).
- [ ] Test: mastery_status_locked_until_prerequisite_mastered.

## Feature 3 — Two-step retrospective confidence
- [ ] reviews.rs: Review.confidence_post + NewReview.confidence_post. insert + get + list + row_to_review (col 14).
- [ ] commands/review.rs: submit_review confidence_post: Option<u8>, validate 1-5, pass to NewReview.
- [ ] tauri.ts: submit() confidencePost + ReviewResult unaffected.
- [ ] ReviewSession.tsx: after flip, before FSRS rate, show retrospective ConfidenceRating.
      Reuse ConfidenceRating with a retrospective legend prop. Pass both values to submit.
- [ ] Test: review_persists_both_confidence_values.

## Verifications — ALL PASS
- [x] cargo test: 192 + 55 ok, 0 failed, 2 ignored (returns_21_params left as-is)
- [x] tsc --noEmit: clean (exit 0)
- [x] biome check src/: clean (5 files auto-formatted)
- [x] vitest run --no-file-parallelism: 141 passed / 31 files (3 stderr errors are
      pre-existing tts-button.test.tsx error-path noise, NOT failures)

## Review
- Migration v13 = 1 file (schema_v13.sql): notes 12-step rebuild adds
  'worked_example' to CHECK preserving all 9 cols + both indices + FTS5; then
  plain ALTER ADD prerequisite_deck_id on decks, ALTER ADD confidence_post on reviews.
- DeckRepo::create widened to 7 args (prerequisite_deck_id) — 9 call-sites fixed.
- All 3 features delivered + tested. No residual bugs found.
