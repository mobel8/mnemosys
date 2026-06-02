# Lessons — Mnemosys

## Timestamp units: backend stores Unix SECONDS, not millis
- Rust side uses `Utc::now().timestamp()` everywhere (cards.last_review, sketches.created_at, wellness.created_at, notes.created_at) → **Unix seconds**.
- JS `new Date(ts)` expects **milliseconds**. Feeding seconds straight in yields 1970 dates.
- When formatting any backend timestamp for display, multiply by 1000 first. CardList's existing `formatTimestamp(last_review)` is already buggy this way (pre-existing, out of scope to fix here).
- Wellness rows carry a `date: "YYYY-MM-DD"` string — prefer it over `created_at` for date labels (no unit trap).

## Testing Radix DropdownMenu in jsdom
- `fireEvent.click` does NOT open a Radix DropdownMenu. Use `@testing-library/user-event` (`await user.click`) + polyfill `Element.prototype.{hasPointerCapture,setPointerCapture,releasePointerCapture,scrollIntoView}` in `beforeAll`. Query items with `findByRole("menuitem", …)`. Pattern lives in `tests/unit/mnemonic-helper.test.tsx`.

## `vi.mock("@/lib/queries", …)` uses a full object literal (no importActual)
- Any hook the component-under-test imports MUST have a stub in the mock, or it's `undefined` at render → crash. When adding a hook call to a component, grep tests that render it and patch their query mocks too (e.g. added `useCardSketches`/`useUpdatePlan`/`useDeletePalace` stubs to existing tests).

## Biome gotchas hit
- `aria-label` on a bare `<span>` → invalid; add `role="img"` when the element (e.g. an emoji) is semantically an image.
- `useValidAnchor`: a literal `href="#"` flags; mirror existing pattern `href={to ?? "#"}` (dynamic) in router `<Link>` mocks.
- Run `biome check --write <files>` to auto-fix formatting before the final repo-wide `biome check .`.

## Native <select> → Radix Select swap can break unit tests (design polish)
- Tests that drive a control via `fireEvent.change(el, { target: { value } })` and cast it to `HTMLSelectElement` (e.g. DeckPodcastDialog voice pickers, `tests/unit/deck-podcast-dialog.test.tsx`) ONLY work with a real `<select>`. Radix `<Select>` renders a button trigger — `fireEvent.change` is a no-op on it, so state never updates and the test fails.
- Resolution when "tests must pass" outranks "replace native selects": KEEP the native `<select>` but style it to the `ui/select` trigger voice (`flex h-9 w-full items-center rounded-lg border border-input bg-card px-3 py-2 text-sm shadow-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background`). design.md explicitly allows this fallback ("sinon stylise-le proprement").
- Selects only checked via `getByLabelText`/`getByRole` (no `fireEvent.change`) CAN safely become Radix `<Select>` — keep the same `aria-label` on `<SelectTrigger>` so `getByLabelText` still resolves (e.g. Planner trigger-type/deck selects, Metronome signature). Radix forbids empty-string `SelectItem` values → use a `"none"` sentinel mapped to `null`.
- Switch swap (`<input type=checkbox>` → `ui/switch`) is test-safe when the checkbox isn't asserted; use `onCheckedChange` (not `onChange`) and keep the `data-testid`.
