# Changelog

## [0.10.0] — Audit qualité multi-agents : 48 corrections critical + high (2026-06-03)

Audit exhaustif (52 finders + 7 stratèges + 7 veille concurrentielle, ~533
constats → 132 problèmes triés) puis correction des **48 problèmes critical +
high** par escouades de fixers, suivi d'une vérification centrale complète
(tsc · biome · vitest · cargo check/fmt/clippy/test · console).

### Correctness / parcours (critique)
- **P001** : les cartes neuves (`state='new'`) n'entraient jamais dans la file
  de révision (`due_cards` filtrait `next_review IS NOT NULL`) — un deck neuf
  était inétudiable. Fusion des cartes neuves dans la file + tests.
- **P003** : `submit_review` (update carte + log + JOL + gamification) désormais
  dans une seule transaction (atomicité).
- **P004** : la recherche de cartes ne fuit plus entre decks.
- **P005** : le mode mains-libres ne rejoue plus les cartes déjà notées.
- **P006/P007** : rétention par deck réellement appliquée au scheduling FSRS ;
  source unique des paramètres FSRS-6 par défaut (fin des poids FSRS-5 périmés).
- **P016/P017/P018** : suppression des N+1 (`due_cards`, `PalaceReview` via la
  nouvelle commande `get_card_with_note`) + index couvrant `idx_cards_due_deck`
  (migration v18).

### Sécurité / distribution
- **P033** : permissions du fichier de session/secrets durcies (0600).
- **P034** : CSP stricte (fin de `csp: null`).
- **P035** : scope d'écriture FS resserré (retrait de `$HOME`/`$DESKTOP`/`$DOCUMENT`).
- **P036** : auto-updater rendu opt-in derrière la feature `updater` (plus de
  `pubkey` vide + endpoint live).
- **P037** : `cargo-deny` / vérification de licences en CI (conflit GPL webgazer).
- **P013/P014/P044** : intégrité DB (FK `ON DELETE`, index, migration panic-safe).

### Accessibilité / i18n
- Lecteurs d'écran : flip de carte annoncé, `inert` sur la face cachée, sliders
  labellisés, heatmap décrite, titres de section en vrais `<h2>` (P020/P021/P024/P027/P028).
- `prefers-reduced-motion` respecté globalement (`<MotionConfig reducedMotion="user">`).
- Libellés UI et messages d'erreur backend (sync, TTS Piper) francisés (P030/P031).

### Langues
- OCR français (`fra.traineddata` bundlé) + langue OCR configurable (P032).
- Cloze/occlusion : masquage par index ancré (fini le faux positif sous-chaîne) (P010).
- Dictionnaire inline câblé au clavier en Lecture (P045/P046).

### Qualité
- tsc · Biome (225 fichiers) · Vitest (191) · cargo check/fmt/clippy `-D warnings`/test : verts.
- *(Les 84 problèmes medium/low restants sont planifiés pour une 0.10.x.)*

## [0.9.0] — Refonte design « Studio Moderne » + apprentissage des langues (2026-06-02)

Refonte visuelle premium de toute l'application (système de design verrouillé,
documenté dans `design.md`) et quatre nouvelles fonctionnalités tournées vers
la mémorisation des langues.

### Design — « Studio Moderne » (modern-minimal, light + dark)
- Système de tokens OKLCH complet dans `src/styles/globals.css` : accent
  indigo-violet câblé (`--primary`/`--accent`/`--ring`), papier chaud (clair) /
  ardoise-indigo (sombre), ombres douces tokenisées, palette de graphes,
  échelle de marque `--brand-50…900`.
- Typographie auto-hébergée (offline) : **Space Grotesk** (titres) + **Inter**
  (corps) + **JetBrains Mono** (chiffres) via `@fontsource-variable/*`.
- `ui/select.tsx` (Radix) ajouté ; tous les `<select>`/checkboxes natifs
  remplacés par des primitives stylées. États vides/chargement premium
  (skeletons). Coquille refaite : logo dégradé, navigation groupée, fil
  d'Ariane + libellés 100 % en français.

### Capture → cartes (OCR hors-ligne)
- Nouvelle page `/capture` : coller (Ctrl+V), déposer ou choisir une image →
  reconnaissance de texte **hors-ligne** (tesseract.js, assets bundlés, zéro
  réseau) → génération de cartes Cloze ou Recto/Verso.

### Apprentissage des langues
- **Dictionnaire inline** : survol d'un mot en Lecture → définition, IPA et
  traduction française (mini-dictionnaire embarqué).
- **Vocabulaire par fréquence** (`/vocabulary`) : génération de decks à partir
  des mots anglais les plus fréquents, traductions auto pour les mots courants.
- **Prononciation** (`/pronunciation`) : drills de paires minimales anglaises
  (écoute et identifie) avec TTS et repli sur la voix du système.

### Qualité
- tsc, Biome (156 fichiers), Vitest (191/191) verts ; build de release
  (deb / rpm / AppImage) produit.

## [0.8.0] — Vagues 20-23 (2026-05-27)

Dernière salve : algorithmes SRS supplémentaires, planification
comportementale, IA offline/image, et analytics temporels. Tout opt-in.

### V20 — Algorithmes SRS avancés
- **HLR scheduler** (Settles & Meeder ACL 2016) : half-life regression
- **MEMORIZE scheduler** (Tabibian PNAS 2019) : optimal control
- → 5 algos pluggables par deck (FSRS-6 / SM-2 / Leitner / HLR / MEMORIZE)
- **BKT Concept Mastery** (Corbett & Anderson) : % maîtrise par tag dans /stats
- Migration v15 (CHECK scheduler_kind étendu)

### V21 — Planification + mnémotechnique
- **Implementation Intentions** (Gollwitzer 1999, d=0.65) : route /planner,
  « quand je X alors j'étudie Y » + rappels locaux. Migration v16 (study_plans)
- **Major System / PAO** : route /mnemonics, conversion chiffres → mots

### V22 — IA/audio complète
- **Piper TTS local** : synthèse vocale offline (alternative à OpenAI)
- **Mnemonic image** (DALL-E) : illustration mnémotechnique des cartes refractaires
- **Calibration rétrospective** (Bang & Fleming 2018) : γ_post dans le dashboard

### V23 — Analytics temporels + accessibilité
- **Temporal Mastery Graph** : évolution de la rétention par tag dans le temps
- **Hands-free Review Mode** : révision 100% audio + voix (TTS + Whisper)

### Validation v0.8.0
- cargo : 237 lib + 55 integration (0 failed, 1 ignored documenté)
- vitest : 182/182 (43 fichiers, parallèle, 0 flakiness)
- tsc + biome (repo entier) + clippy : 0 erreur
- vite build : chunk eager 95 kB (gzip 30 kB)
- DB migrations v1→v16, ~95 commandes Tauri, 22 routes, 9 templates, 5 schedulers

---

## [0.7.0] — Vagues 10-19 (2026-05-27)

Suite de l'effort de recherche appliquée : modes disciplinaires, langue,
créatifs, IA locale et une passe d'optimisation. Tout opt-in, tout testé.

### V10 — Mode Langue
Template bidirectional (L2↔L1), frequency_band (couverture vocab Pareto),
deck language_mode. Migration v11.

### V11 — Subtitle Import + Knowledge Graph
Parser .srt/.vtt → cartes, graphe de co-occurrence de tags (route /graph,
SVG force-directed maison). Migration : néant (table words via v14 plus tard).

### V12 — Modes cognitifs avancés
Pretest Mode (Pan 2023), Self-explanation (Chi 1989), WebGazer Focus Guard
(mind-wandering webcam, 100% local, opt-in).

### V13 — IA multi-agent
Card critic pass (Generator→Critic, PROClaim 2025) + Mnemonic Helper
(aide mnémotechnique pour cartes à lapses ≥ 3).

### V14 — Modes disciplinaires
Illness Script (médecine, Charlin 2007) + Refutation Card (sciences,
Tippett 2010). Migration v12.

### V15 — Maths + métacognition
Faded Worked Example (Sweller/Renkl) + Mastery Gating (Bloom 90%,
prerequisite_deck_id) + Two-step retrospective confidence (Bang & Fleming
2018). Migration v13.

### V16 — Modes créatifs
Métronome + Ear Training (route /music), Gesture Drawing Timer
(route /gesture). 100% Web Audio + Canvas, zéro backend.

### V17 — Langue/lecture avancé
Shadowing Mode (waveforms TTS vs voix, /shadowing), Reading Import
LingQ-style (mots par statut, /reading, migration v14 word_status),
citations PDF (tag source).

### V18 — IA locale + neuro
Local AI Tutor via Ollama (génération offline, privacy), Chronotype
Calibration (rMEQ), Context Ambient sound (white/pink/brown/rain Web Audio).
Aucune migration (tout en settings).

### V19 — Performance & fluidité
- Bundle : chunk eager **598 kB → 90 kB** (gzip 28 kB) via manualChunks
  (react-vendor/tanstack/motion/radix). webgazer/three/recharts hors
  graphe eager.
- Memoization : CardRow (React.memo), KnowledgeGraph layout (useMemo).
- Animations GPU : wizard progress (scaleX), flip 180ms.
- Qualité : flakiness tts-button corrigée (vitest parallèle 164/164),
  biome 0 sur tout le repo, clippy 0 warning.

### Validation v0.7.0
- cargo : 203 lib + 55 integration (0 failed, 1 ignored documenté)
- vitest : 164/164 (parallèle, plus de flakiness)
- tsc + biome (repo entier) + clippy : 0 erreur
- DB migrations v1→v14, ~80 commandes Tauri, 17 routes

---

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
