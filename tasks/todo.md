# V17 — Langue/lecture avancé

DB v13 -> v14. Git clean baseline. 3 features.

## Feature 1 — Shadowing Mode (frontend only, state local)
- [ ] `src/components/ShadowingPractice.tsx` — TTS reference + MediaRecorder + dual waveform canvas
- [ ] `src/routes/shadowing.tsx` + `src/routes/shadowing.page.tsx`
- [ ] register route in `routeTree.ts`, add Sidebar entry "Shadowing" (AudioLines icon)
- Waveform: decode AudioBuffer -> downsample ~200 points -> draw bars on canvas
- Reuse VoiceAnswerButton MediaRecorder pattern + synthesize_audio pattern
- Web Audio + MediaRecorder cleanup on unmount

## Feature 2 — Reading Import (LingQ-style)
- [ ] Migration v14: schema_v14.sql CREATE TABLE word_status; CURRENT_VERSION=14; wire run()
- [ ] `src-tauri/src/db/reading.rs` — WordStatus + ReadingRepo (get_word_statuses, set_word_status, create_cards_from_words)
- [ ] register repo in db/mod.rs
- [ ] `src-tauri/src/commands/reading.rs` — 3 commands
- [ ] register module commands/mod.rs + handlers lib.rs
- [ ] TS types + api.reading in tauri.ts; query hooks queries.ts
- [ ] `src/components/ReadingImport.tsx` — textarea, tokenize, clickable colored words, cycle status, create cards, stats
- [ ] `src/routes/reading.tsx` + `reading.page.tsx`, routeTree, Sidebar "Lecture" (BookOpen)

## Feature 3 — PDF citations (lightest)
- [ ] `commands/ai.rs:generate_cards_pdf` — derive filename from pdf_path, push tag `source:<filename>` onto each generated card
- [ ] AiGenerator.tsx — surface source tag badge on drafts

## Verifs finales — ALL PASS
- [x] cargo test: 200 lib + 55 integ, 0 failed, 1 ignored (FSRS, as required)
- [x] tsc --noEmit: clean
- [x] biome check src/: clean (0 errors; 3 files auto-formatted)
- [x] vitest new files: 7 passed. Full suite: 152 passed / 35 files (3 stderr
      errors = pre-existing tts-button error-path noise, NOT failures)
- [x] vite build: ok

## Tests
- [x] tests/unit/reading-import.test.tsx (tokenize + 3 component tests = 4)
- [x] tests/unit/shadowing.test.tsx (computeWaveformPeaks x2 + render = 3)
- [x] Rust: 6 ReadingRepo tests + 2 pdf_source_filename tests

## Review
- F1 Shadowing: ShadowingPractice.tsx (Web Audio decode→peaks→canvas, MediaRecorder,
  TTS reuse, full cleanup) + route /shadowing + Sidebar (AudioLines). No DB.
- F2 Reading: migration v14 (word_status, pure CREATE TABLE) + db/reading.rs (ReadingRepo)
  + commands/reading.rs (3 cmds) + tauri.ts/queries.ts + ReadingImport.tsx + route /reading
  + Sidebar (BookOpen). Optimistic status cycling, coverage stats, card creation.
- F3 PDF citations: generate_cards_pdf tags each card `source:<filename>` (dedup) +
  AiGenerator source badge. Page mapping intentionally skipped (pdf-extract flattens).
- No new deps. NoteRepo::create / DeckRepo::create call-sites untouched. No residual bugs.
