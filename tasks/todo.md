# Wire 4 dead-UI features (backend complete, UI never connected)

Branch: `feat/wire-dead-ui`. Frontend-only; no backend/DB changes.
Cargo baseline (MUST stay identical): 246 passed / 0 failed / 1 ignored ; 55 passed.

## Feature 1 — Palace delete + rename (`src/routes/palaces.page.tsx`)
- [ ] Extract palace tile into `PalaceCard` with a DropdownMenu (Renommer / Supprimer), mirroring `DeckCard`.
- [ ] Rename: Dialog editing name/description/template via `useUpdatePalace`.
- [ ] Delete: AlertDialog confirm via `useDeletePalace`. Toasts both paths.
- [ ] Keep the whole-tile `<Link>`; stop dropdown clicks from navigating.

## Feature 2 — Plan edit (`src/routes/planner.page.tsx`)
- [ ] Add `useUpdatePlan` hook in queries.ts (mirror toggle/delete, invalidate studyPlans).
- [ ] "Modifier" button per plan → pre-fills the existing form via `editingId` state.
- [ ] Submit branches create vs update; "Annuler" resets edit mode + form.

## Feature 3 — Sketch history (`src/components/CardList.tsx`)
- [ ] Add "Voir les croquis" menu item (only when `card != null`).
- [ ] Dialog with grid of past sketches via `useCardSketches(card.id)`. base64 PNG `<img>`, with date. Empty-state message.

## Feature 4 — Wellness history (`src/components/stats/WellnessHistory.tsx` new)
- [ ] New component via `useRecentWellness(14)`: mood emoji, sleep h, stress. List/mini-bars.
- [ ] Loading + empty (invite to enable neuro modes) states (mirror `ConceptMastery`).
- [ ] Mount in `stats.page.tsx` after existing sections.

## Tests
- [ ] tests/unit/palace-management.test.tsx (menu renders, delete confirm calls hook)
- [ ] tests/unit/wellness-history.test.tsx (empty state, renders logs)
- [ ] sketch + plan edit: 1 test each if simple

## Final checks (all green)
- [x] cargo test result UNCHANGED vs baseline (246/0/1 ; 55) — identical, backend untouched
- [x] tsc --noEmit — exit 0
- [x] biome check . — 211 files, 0 errors
- [x] vitest run — 46 files / 191 tests passed (was 177; +14 new)

## Review
- All 4 features wired; every checkbox above done.
- Diff touches only `src/` + `tests/` (zero `src-tauri/` changes). No new deps, no `.sql`, no `any`, no `unwrap`.
- F1: extracted `PalaceCard` w/ DropdownMenu (Renommer dialog + Supprimer AlertDialog). Bonus fix: badge now shows humanized template label ("Maison") instead of raw "house".
- F2: added `useUpdatePlan` (invalidates studyPlans); planner form doubles as edit form via `editingId`.
- F3: `SketchHistoryDialog` in CardList (lazy query gated on open). Found+handled a unit bug: sketch `created_at` is Unix *seconds* (Utc::now().timestamp()), so added `formatSketchDate` that ×1000 — avoids 1970 dates.
- F4: new `WellnessHistory.tsx` mounted after MasteryTimeline; mood emoji + sleep + stress; opt-in empty state.
- Side note (NOT fixed, out of scope): CardList's existing "Dernière review" column feeds `last_review` (also seconds) into the ms-based `formatTimestamp` — pre-existing date bug, untouched per "backend/behaviour minimal impact".
