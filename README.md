# Mnemosys

> L'app de mémorisation next-gen, avec l'algorithme FSRS-6.

**Stack** : Tauri 2 · React 19 · TypeScript · Tailwind 4 · Rust · SQLite

## Installation
- Node 22+, pnpm 9+, Rust 1.81+
- `pnpm install`

## Développement
- `pnpm tauri:dev` lance l'app en mode dev

## Build
- `pnpm tauri:build` produit le binaire de release

## Tests
- `pnpm test` (TS)
- `cd src-tauri && cargo test` (Rust)

## Roadmap
- Session 1 : MVP Desktop (CURRENT) — FSRS-6, CRUD decks/cartes, review session, stats
- Session 2 : IA card gen, TTS, Image Occlusion, import .apkg
- Session 3 : Sync cloud Supabase + Auth multi-device
- Session 4 : FSRS Optimizer + analytics avancés + packaging release

## Crédits
- Algorithme FSRS-6 : [open-spaced-repetition](https://github.com/open-spaced-repetition)
- shadcn/ui pour les composants
