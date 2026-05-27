# Changelog

## [0.6.0] — Vagues 7-9 + S4 final (2026-05-27)

Continuation de l'effort de recherche scientifique appliquée. Vagues 7-9
ajoutent les **Tier S** identifiés dans la roadmap (impact × différenciation
maximum) + finalise la Session 4 release tooling.

### Vague 7 — Tier S métacognition + drawing (commit feat(G7))
- **Sketch-before-flip** (drawing effect Wammes 2016, +30-50% rappel).
  Canvas HTML5 Pointer Events, pression-sensible, pencil/eraser/clear,
  export PNG base64 stocké dans la nouvelle table `review_sketches`.
- **Delayed-JOL Predictions** (Rhodes & Tauber 2011 méta 4554 sujets,
  g=0.93 sur resolution). Modal polling toutes les 5 min, slider 0-100%
  pour prédire la chance de réussir une carte vue ~30 min plus tôt.
- **Calibration Dashboard** dans `/stats` : Goodman-Kruskal γ,
  bias, histogramme 10 buckets predicted vs actual. **Premier SRS à
  exposer γ aux apprenants.**
- Migration DB v8 (review_sketches) + v9 (jol_predictions + index unresolved)
- 2 toggles dans `<ReviewSettingsSection />`
- 7 tests cargo + 7 tests Vitest

### Vague 8 — Audio-first features (commit feat(G8))
- **Deck Podcast (NotebookLM-style)** : transforme un deck en podcast
  2-voix téléchargeable. Script Claude Host/Expert × 3 formats
  (DeepDive/Brief/Critique), TTS OpenAI multi-voix, concat MP3
  byte-level, cache SHA-256 dans `<app_cache_dir>/podcasts/`.
- **Whisper Mode Review** : réponse vocale via OpenAI Whisper API
  (MediaRecorder → base64 → transcription → fuzzy match Levenshtein).
  Mutuellement exclusif avec Type-the-answer.
- 3 commandes podcast + 1 commande whisper
- `<DeckPodcastDialog />` + `<VoiceAnswerButton />`
- 10 tests cargo + 6 tests Vitest
- Cargo : +base64, reqwest +multipart

### Vague 9 — Memory Palace 3D Builder (moonshot) (commit feat(G9))
- **Memory Palace 3D Builder** (Krokos et al. 2019 +8.8% en VR vs
  liste plate, place/grid cells naturels — Nobel 2014 O'Keefe/Moser).
  React Three Fiber + Three.js dans Tauri WebView.
- 3 templates 3D pré-fabriqués : House / Street / Castle
- Caméra FPS WASD/ZQSD + OrbitControls drag-to-look
- Loci flottants animés avec labels texte, click pour afficher carte
- Mode Builder (placement) + mode Review (walk-through)
- Migration DB v10 (palaces + palace_loci, FK cascade)
- 9 commandes Tauri + 3 routes `/palaces`, `/palaces/$id`,
  `/palaces/$id/review`
- Sidebar : entrée "Memory Palaces" (Compass icon)
- 10 tests cargo + 5 tests Vitest
- pnpm : +three +@react-three/fiber +@react-three/drei +@types/three

### Session 4 Final (commit feat(S4-final))
- **`<FsrsOptimizerSection />`** UI dans settings : progress bar si
  <1000 reviews ; warning ambre + bouton "Calibrer FSRS" si ≥1000.
- **`.github/workflows/ci.yml`** : 3 jobs (frontend/backend/build
  matrix linux/macos/windows), upload-artifact 14j
- **`tauri-plugin-updater` config** dans `tauri.conf.json` (pubkey
  vide = dormant, prêt à activer avec keypair + manifest)
- **`docs/SESSION_4_RELEASE.md`** ~280 lignes (procédure complète
  release/signing/updater)

### Validation v0.6.0
- **cargo test** : 165 lib + 47 integration verts (1 fail pré-existant
  FSRS optimizer NotEnoughData, hors scope)
- **vitest run** : 116/116 verts
- **tsc --noEmit** : 0 erreur (107 fichiers)
- **biome check src/** : 0 erreur
- **Playwright E2E** : screenshots V7/V8/V9 capturés (palaces, settings
  full, stats calibration, dark mode)

---

## [0.5.0] — Vagues 1-5 (2026-05-27)

Cinq vagues de fonctionnalités issues d'une revue de littérature
(~25 000 mots, ~300 sources scientifiques). Chaque feature est
**opt-in** (désactivée par défaut), backwards-compatible avec les
utilisateurs Session 1.

### Vague 1 — Gamification éthique (commit feat(G1))
- Streaks (avec freeze gratuit 2/mois, jamais punitif)
- Achievements intrinsèques (10 badges, no virtual currency)
- Niveau maîtrise par deck (5 stages WaniKani : Apprentice → Burned)
- Migration DB v4 (user_stats + achievements tables)
- Sidebar : entrée "Succès" (icône Trophy)
- TopBar : `<StreakWidget />` (flamme + count + modal heatmap 30j)
- DeckCard : badge mastery
- 6 tests cargo + 10 tests Vitest

### Vague 2 — Cognitive features (commit feat(G2))
- **Type-the-answer** mode (generation effect d=0.40, Slamecka 1978).
  Fuzzy scoring via Levenshtein, bands Excellent/Proche/Incorrect.
- **Confidence rating** (CBM Gardner-Medwin UCL). Échelle 1-5
  asymétrique stockée dans `reviews.confidence`.
- **Pre-questioning IA** (g≈0.45, Pan et al. 2023 méta-analyse).
  Génère 2-3 questions d'amorçage avant un nouveau bloc via Claude.
- Migration DB v5 (ALTER reviews ADD confidence)
- 3 settings toggles dans `<ReviewSettingsSection />`
- 11 tests Vitest + 1 test cargo

### Vague 3 — Neuro modes opt-in (commit feat(G3))
- **Mood/Sleep check-in** pré-session (gating dynamique cartes
  new si sommeil < 6h).
- **Movement break reminder** toutes les 25 min (Roig d=0.52 acute
  exercise, méta-analyse 2013).
- **Cyclic sighing primer** 5 min (Spiegel/Huberman Cell Reports
  Med 2023). Animation respiration 2 inhales + 1 exhale long.
- Migration DB v6 (wellness_logs table local-only)
- `<NeuroModesSection />` dans settings avec master switch
- 8 tests Vitest + 3 tests cargo

### Vague 4 — Schedulers pluggables (commit feat(G4))
- **SM-2** (Anki classique, déterministe, auditable)
- **Leitner 5-box** (1/3/7/14/30 jours, idéal débutants)
- **FSRS-6** reste défaut (recommandé)
- Trait `Scheduler` Rust + dispatcher `from_kind(...)`
- Migration DB v7 (ALTER decks ADD scheduler_kind)
- `<SchedulerPicker />` dans CreateDeckDialog + EditDeckDialog
- 12 tests unit + 8 tests cargo

### Vague 5 — IA augmentée + Interleaved (commit feat(G5))
- **Champ "Why?" + "Example"** auto-générés par Claude (elaborative
  interrogation g=0.55, Bisra et al. 2018 + concrete examples d=0.30,
  Micallef & Newton 2024). Opt-in checkbox dans AiGenerator.
- **Interleaved Review Mode** (Rohrer & Taylor 2015 — ×2 sur test
  différé). Sélecteur multi-decks + shuffle stdlib-only (xorshift32).
- Route `/review-interleaved` + entrée Sidebar (Shuffle icon)
- ReviewCard : badge deck + sections collapsibles Pourquoi/Exemple
- 3 tests cargo + 4 tests Vitest + 3 tests unit ai parser

### Validation globale (à 0.5.0)
- **17 fichiers de tests Vitest, 105 tests verts**
- **cargo test --no-fail-fast** : ~150 tests verts
- **tsc --noEmit** : 0 erreurs
- **biome check src/** : 0 erreurs (116 fichiers)
- **Playwright E2E** : 8/8 tests (smoke + interactive + screenshots + console capture)

### Sources principales
Voir USER_GUIDE.md pour les références complètes. Quelques highlights :
- Roediger & Karpicke 2006 (retrieval g=0.50), Cepeda 2006 (spacing 184 articles g=0.46)
- Wammes 2016 (drawing +30-50%), Rohrer 2015 (interleaving ×2)
- Slamecka 1978 (generation d=0.40), Gardner-Medwin UCL (CBM)
- Pan 2023 (pre-questioning g=0.45), Bisra 2018 (self-expl g=0.55)
- Hu 2020 méta TMR, Roig 2013 (exercise d=0.52)
- Spiegel/Huberman Cell Rep Med 2023 (cyclic sighing)

---

## [0.4.0] — Sessions 3 + 4 partial (2026-05-27)

### Session 3 — Sync cloud (scaffolding)
- Module `src-tauri/src/sync/` (auth + client + delta + apply LWW + cycle)
- 4 commandes Tauri (login/logout/status/now)
- Migration DB v3 (remote_id + sync_state table)
- `<SyncSection />` UI 3-état
- 13 tests Rust LWW/delta/tombstones

### Session 4 — FSRS Optimizer + infra (partial)
- `fsrs/optimize.rs` + commande `optimize_fsrs_params`
- `tauri-plugin-updater` configuré (endpoint placeholder)
- `beforeBuildCommand` fix pour pnpm 10+

---

## [0.3.0] — Session 2 (2026-05-26)

- AI flashcard generation via Claude (text + PDF)
- TTS via OpenAI (SHA-256 disk cache, 8 voix)
- APKG Anki import (collection.anki2 + media)
- Image-occlusion template (draw masks on image)
- `reset_card` command + UI
- Settings : Anthropic key + OpenAI key + TTS voice/speed

---

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
