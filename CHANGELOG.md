# Changelog

## [0.1.0] — Session 1 (2026-05-26)

### Added
- Tauri 2 + React 19 + Tailwind 4 + TypeScript desktop scaffold
- FSRS-6 algorithm via fsrs-rs (21 params, 27 golden tests)
- SQLite DB layer : decks, notes, cards, reviews, FTS5 search
- 25+ Tauri commands (decks, cards, review, stats, demo, io, settings)
- TanStack Router (imperative) + TanStack Query + Zustand state
- shadcn/ui design system (light/dark theme)
- Review session UI : flip animation, 4-button rating, intervals preview, hotkeys
- Stats dashboard : today, GitHub-style heatmap, reviews/retention charts
- 4 demo decks (835 cartes total) : Vocab EN→FR, Capitales, JS/TS, Bio cellulaire
- Import/export collection en JSON
- First-run wizard, shortcuts help dialog, error boundary

### Known issues
- Vite 8 + rolldown + @tailwindcss/vite incompat — using Vite 7 stable
- GTK display required for tauri:dev (X server needed on Linux)
- Tauri:build not tested in Session 1 (Session 4 release packaging)
