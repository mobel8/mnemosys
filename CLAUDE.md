# Mnemosys — instructions de travail

App SRS desktop (clone d'Anki) : Tauri 2 + React 19 + TS + Tailwind v4 + Rust.
Voir `AUDIT_V0.11.md` (audit produit) et `ARCHITECTURE.md` (technique).

## ⚡ Itération rapide — RÈGLES ABSOLUES sur cette machine (7 GB RAM, disque quasi plein)

**Jamais de build de release local.** `pnpm tauri:build` (LTO + codegen-units=1)
prend ~1 h ici et crashe souvent en OOM (`STATUS_STACK_BUFFER_OVERRUN`) ou
remplit le disque. À la place :

| Besoin | Commande | Durée |
|---|---|---|
| Itérer sur l'UI (React/CSS) | `pnpm tauri:dev` puis éditer — **HMR instantané**, AUCUN rebuild | ~0 s par changement |
| Itérer sur le Rust | `pnpm tauri:dev` recompile seul le delta (debug, incrémental) | ~1-3 min |
| Tester l'UI seule (sans IPC) | `pnpm dev` (Vite nu sur :5173) | ~0 s |
| Vérif TS | `pnpm typecheck` | ~30 s |
| Tests front | `pnpm test -- --maxWorkers=2` (OBLIGATOIRE : sans cap, tinypool crashe ici) | ~2 min |
| Tests Rust | `CARGO_BUILD_JOBS=2 cargo test` dans src-tauri | minutes (incrémental) |
| **Installateur de release** | **GitHub Actions** : workflow « Release » (`workflow_dispatch` sur la branche, ou pousser un tag `v*` qui crée la GitHub Release) puis télécharger l'artifact `mnemosys-windows-installer` | ~15-20 min sur leurs runners |

Notes :
- `[profile.dev]`/`[profile.test]` ont `debug = 0` (Cargo.toml) — c'est ce qui
  rend les builds locaux possibles (RAM/disque/temps ÷2 à ÷3). Pour du debug
  symbolique ponctuel : `CARGO_PROFILE_DEV_DEBUG=2 cargo build`.
- Si `cargo` meurt avec `STATUS_STACK_BUFFER_OVERRUN` ou « LLVM out of
  memory » : fermer l'app/WebView, `CARGO_BUILD_JOBS=1`, vérifier l'espace
  disque (`target/` gonfle vite ; `cargo clean` libère ~5-10 GB).
- Avant de tester un exe de prod : `pnpm build` D'ABORD, sinon le dist embarqué
  est périmé (leçon vibe-term).
- Pas de `gh` CLI ici — API GitHub + token via `git credential fill`.

## Commandes de vérification (gates CI)

```bash
pnpm typecheck && pnpm lint && pnpm test -- --maxWorkers=2
cd src-tauri && cargo fmt --check && cargo clippy -- -D warnings && cargo test
```

## Architecture v0.11 (post-Recentrage)

- **6 destinations** : `/` (accueil + héros Réviser), `/review-all` (session
  globale entrelacée), `/create` (hub IA/OCR/Vocabulaire/Imports), `/language`
  (Lecture/Shadowing/Prononciation), `/stats` (onglets), `/settings` (onglets).
- **FSRS-6 est l'UNIQUE scheduler** (migration v19 a converti les decks
  legacy). Ne pas réintroduire de sélecteur d'algorithme.
- Les routes `/review/*` se rendent **plein écran** (pas de sidebar) — voir
  `__root.tsx`.
- Ré-apprentissage intra-session : un « Encore » re-file la carte dans la
  session (max 2 passes) — logique dans `ReviewSession.handleRate`.
- Confiance CBM : capturée AVANT le flip (phase question), alimente
  `get_calibration_stats` (source : `reviews.confidence`).
- Invalidations TanStack : par carte = `todayStats` seulement ; le reste via
  `invalidateAfterSession` au démontage de la session. Ne pas ré-élargir.
- Settings : `AppSettings` Rust = source de vérité, miroir TS dans
  `src/lib/tauri.ts`. serde tolère les champs inconnus (vieux settings.json).

## Pièges connus

- Timestamps backend en **secondes** Unix (JS attend des ms — ×1000 à l'affichage).
- Tests jsdom + Radix : voir « Leçons de terrain » dans CONTRIBUTING.md.
- `git` : `core.autocrlf` + biome lf → `.gitattributes` force eol=lf, ne pas le retirer.
- Les jours applicatifs (stats/streak) sont en heure LOCALE (pas UTC) depuis v0.11.
