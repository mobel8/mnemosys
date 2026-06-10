# Mnemosys

> L'app de mémorisation next-gen, propulsée par l'algorithme **FSRS-6** — 100 % locale, ultra-rapide, pensée clavier-first.

[![v0.11.0](https://img.shields.io/badge/version-0.11.0-22c55e)](./CHANGELOG.md)
[![Tauri 2](https://img.shields.io/badge/Tauri-2.x-24c8db)](https://tauri.app)
[![React 19](https://img.shields.io/badge/React-19-61dafb)](https://react.dev)
[![Rust 1.81+](https://img.shields.io/badge/Rust-1.81%2B-orange)](https://www.rust-lang.org)
[![FSRS-6](https://img.shields.io/badge/FSRS-6-purple)](https://github.com/open-spaced-repetition/fsrs4anki/wiki/ABC-of-FSRS)

![screenshot](docs/screenshot.png)

---

## Vision

Mnemosys est une app desktop de **répétition espacée (SRS)** taillée pour **les apprenants de langues exigeants** — d'abord l'anglais — qui veulent transformer du texte, des captures d'écran et du vocabulaire réel en cartes, puis les ancrer durablement. Le cœur reste une seule promesse : **retenir plus en révisant moins**, grâce à FSRS-6 et un cycle review/feedback aussi serré que possible.

Depuis la v0.11 (« Recentrage »), l'app assume cette promesse : **6 destinations** (Accueil, Réviser, Créer, Langues, Statistiques, Paramètres), **FSRS-6 comme unique algorithme**, et les quelques extras restants (croquis, mains-libres, podcast, son ambiant) vivent dans un onglet Labs désactivé par défaut. Pas de cloud obligatoire, pas de gamification creuse. C'est l'alternative moderne, performante et transparente à Anki pour 2026.

## Statut

- **Session 1 — MVP Desktop** : ✅ livré
- **Session 2 — IA & contenu** : ✅ livré (AI gen + TTS + APKG + image-occlusion + reset_card)
- **Session 3 — Sync cloud** : ✅ scaffolding livré (désactivé tant qu'aucun projet Supabase n'est configuré)
- **Session 4 — FSRS Optimizer** : ✅ backend livré (UI optimizer + CI + signing à venir)
- **Vagues 1-9 — Recherche scientifique appliquée** : ✅ livrées (cf. [CHANGELOG.md](./CHANGELOG.md))
  - V1 Gamification éthique — streaks + achievements + deck mastery WaniKani-style
  - V2 Cognitive — type-the-answer + confidence rating (CBM) + pre-questioning IA
  - V3 Neuro modes — mood/sleep check-in + movement break + cyclic sighing
  - V4 Schedulers pluggables — FSRS-6 + SM-2 + Leitner 5-box par deck
  - V5 IA augmentée — Why?/Example auto + Interleaved Review mode
  - **V7 Tier S** — Sketch-before-flip + Delayed-JOL + Calibration Dashboard
  - **V8 Audio** — Deck Podcast NotebookLM-style + Whisper Mode Review
  - **V9 Moonshot** — Memory Palace 3D Builder (R3F + 3 templates 3D)
  - **S4-Final** — FSRS Optimizer UI + GitHub Actions CI + tauri-plugin-updater

## Différenciateurs vs Anki / RemNote / Mochi

- **Métacognition de première classe** — confidence rating (CBM) + dashboard de calibration qui montre l'écart entre ta confiance et ta réussite réelle. Rare dans les SRS grand public.
- **Capture → cartes** — OCR d'une capture d'écran ou collage de texte, puis génération de cartes (LLM en option, BYOK) ; pensé pour l'immersion linguistique.
- **FSRS-6, point.** Le vainqueur des benchmarks open-spaced-repetition, avec rétention cible par deck, optimiseur personnel (asynchrone) et **ré-apprentissage intra-session** des cartes ratées — pas un menu de 5 schedulers dont 4 pièges.
- **Local-first + auditable** — base SQLite locale, code ouvert, IA en *Bring-Your-Own-Key* : aucune donnée ne part sans ton action.
- **Sourcing scientifique transparent** — chaque module opt-in cite ses publications (effect sizes) ; FSRS-6 réduit typiquement la charge de révision de **20–30 %** à rétention égale ([benchmark open-spaced-repetition](https://github.com/open-spaced-repetition/srs-benchmark)).

## Fonctionnalités (v0.11.0)

**Cœur SRS**

- **FSRS-6** via la crate `fsrs` 5.2 (21 paramètres, prévisualisation des intervalles, états `new` / `learning` / `review` / `relearning`). [Spec algo](https://github.com/open-spaced-repetition/fsrs4anki/wiki/ABC-of-FSRS).
- **Ré-apprentissage intra-session** : une carte « Encore » revient dans la même session (max 2 repassages) au lieu de disparaître jusqu'au lendemain.
- **Decks + cartes** avec templates `basic`, `basic_reverse` (2 cartes par note) et `cloze` (`{{c1::texte}}` style Anki).
- **Session de review** : flip animé, notation Again/Hard/Good/Easy avec **preview live des intervalles**, raccourcis clavier, suspension/édition à la volée, écran de fin.
- **Dashboard de stats** : KPIs du jour, heatmap GitHub-style sur 1 an, courbes reviews/jour, rétention/jour et **dashboard de calibration** (sélecteur 7j / 30j / 90j / 1 an).
- **FSRS Optimizer** : recalibre les 21 paramètres sur ton propre historique.
- **Export/Import JSON v2 = vrai backup** (état FSRS + historique de reviews) + **import `.apkg` Anki** et sous-titres `.srt`/`.vtt`, regroupés dans le hub « Créer ».
- **4 decks démo — 835 notes (≈ 1 030 cartes)** : Vocabulaire EN→FR (500), Capitales du monde (195, recto-verso), Fondamentaux JavaScript/TypeScript (80), Biologie cellulaire (60).

**Apprentissage des langues**

- **Capture → cartes** : OCR (Tesseract `fra`/`eng`) d'une capture d'écran, puis génération de cartes.
- **Génération IA** (BYOK : Claude / OpenAI / Ollama local) à partir d'un texte, avec critique et champs *Why?/Example* optionnels.
- **Lecture assistée**, **Vocabulaire par fréquence**, **Shadowing** et **Prononciation** (paires minimales, IPA, TTS Piper + Whisper).

**Labs (opt-in, Paramètres → Labs)**

- Croquis avant retournement, réponse vocale (Whisper), mode mains-libres, podcast de deck, son ambiant.
- **Gamification éthique** : streaks + freeze, succès intrinsèques, maîtrise de deck (style WaniKani) — onglet Succès des statistiques.

**Transverse**

- **Thèmes light / dark / system** persistés, **recherche FTS5 trigram**, **first-run wizard** + aide raccourcis (`?`).

## Installation

### Prérequis communs

| Outil | Version |
|-------|---------|
| Node  | **22+** |
| pnpm  | **10+** (le dépôt épingle `pnpm@11` via `packageManager` ; active-le avec `corepack enable`) |
| Rust  | **1.81+** (via [rustup](https://rustup.rs)) |

### Dépendances système

#### Linux (Ubuntu / Debian 24.04+)
```bash
sudo apt update
sudo apt install -y \
  libwebkit2gtk-4.1-dev \
  libjavascriptcoregtk-4.1-dev \
  libsoup-3.0-dev \
  build-essential curl wget file libxdo-dev \
  libssl-dev libayatana-appindicator3-dev librsvg2-dev
```
Sur d'autres distros, équivalents de `webkit2gtk-4.1`, `javascriptcoregtk-4.1`, `libsoup-3.0`.

#### macOS (12+)
```bash
xcode-select --install
```
Rien d'autre — WebKit est embarqué dans le système.

#### Windows (10/11)
- **Microsoft Edge WebView2** : déjà présent sur Windows 11. Pour Windows 10, l'installer depuis le [Evergreen Bootstrapper](https://developer.microsoft.com/microsoft-edge/webview2/).
- Microsoft Visual Studio Build Tools 2022 (composant *Desktop development with C++*).

### Cloner et installer

```bash
git clone https://github.com/mobel8/mnemosys.git
cd mnemosys
corepack enable      # active la version de pnpm épinglée par le dépôt
pnpm install
```

### Lancer en dev

```bash
pnpm tauri:dev
```
Le premier build Rust dure environ **5 minutes** (compilation de Tauri + dépendances). Les suivants sont instantanés grâce au cache.

### Build de release

```bash
pnpm tauri:build
```
Produit un binaire optimisé (`opt-level=s`, LTO, strip) + un installeur natif (`.deb`/`.AppImage` sur Linux, `.dmg`/`.app` sur macOS, `.msi`/`.exe` sur Windows). Ce chemin est validé en CI (matrice Linux / macOS / Windows) ; les bundles y sont produits comme artifacts.

## Stack technique

| Couche | Techno | Version |
|--------|--------|---------|
| Bundler frontend | Vite | 7.x |
| Framework UI | React | 19.2 |
| Langage UI | TypeScript | 6.x |
| Styling | Tailwind CSS | 4.x (`@tailwindcss/vite`) |
| Design system | shadcn/ui + Radix UI | – |
| Routing | TanStack Router | 1.170 (imperative) |
| State serveur | TanStack Query | 5.x |
| State client | Zustand | 5.x |
| Animations | Framer Motion | 12.x |
| Icons | lucide-react | 0.469 |
| Charts | Recharts | 3.x |
| Hotkeys | react-hotkeys-hook | 5.x |
| Confetti | canvas-confetti | 1.9 |
| Shell desktop | Tauri | 2.x |
| Backend | Rust | 1.81+ |
| DB | rusqlite (SQLite bundled) | 0.39 |
| SRS | fsrs (FSRS-6) | 5.2 |
| Linter (TS) | Biome | 2.x |
| Tests (TS) | Vitest + Testing Library | 2.x / 16.x |
| Tests (Rust) | `cargo test` | – |
| E2E | Playwright | 1.60 |

## Architecture

Voir [ARCHITECTURE.md](./ARCHITECTURE.md) pour le détail (diagramme, schéma DB, table des commandes Tauri, ADR).

## Roadmap

Tout l'historique livré (Sessions 1→4 puis Vagues 1→9) est détaillé dans le [CHANGELOG.md](./CHANGELOG.md). Ce qui reste à venir :

- **Durcissement** : audit de dépendances en CI, crash reporting opt-in, signature des binaires des 3 OS.
- **Sync cloud GA** : sortir Supabase du mode scaffolding (résolution de conflits, multi-device).
- **Codegen de la frontière IPC** (tauri-specta) pour supprimer la duplication manuelle des wrappers.
- **Couverture linguistique** : enrichir dictionnaire/IPA et traductions du vocabulaire par fréquence.

## Tests

| Commande | Périmètre |
|----------|-----------|
| `pnpm test`            | Tests unitaires TypeScript (Vitest, jsdom) |
| `pnpm test:watch`      | Vitest en mode watch |
| `pnpm test:e2e`        | Tests Playwright (lance son propre serveur Vite) |
| `cd src-tauri && cargo test` | Tests Rust (DB, FSRS scheduler, commands) |
| `pnpm typecheck`       | Vérifie tous les fichiers TS/TSX |
| `pnpm lint`            | Biome check |

**Couverture actuelle** : suite de tests TypeScript (Vitest, jsdom) sur les composants et utilitaires, et plus de 250 tests Rust (golden FSRS, scheduler, DB, commandes). La CI exécute frontend (tsc + Biome + Vitest), backend (`cargo fmt`/`clippy -D warnings`/`test`), un *gate* de licences et un build matriciel Linux / macOS / Windows.

## Contribution

Voir [CONTRIBUTING.md](./CONTRIBUTING.md) pour le setup de l'environnement de dev, le style de code, et le process de PR.

## Documentation utilisateur

Pas familier avec la répétition espacée ou tu veux maîtriser tous les raccourcis ? Lis le [USER_GUIDE.md](./USER_GUIDE.md).

## Tests manuels

Pour valider le MVP de bout en bout, suis la procédure pas-à-pas dans [TEST_CHECKLIST.md](./TEST_CHECKLIST.md).

## Crédits & License

- **FSRS-6** : algorithme open-source par [Jarrett Ye / open-spaced-repetition](https://github.com/open-spaced-repetition).
- **shadcn/ui** : composants UI sous license MIT.
- **Tauri** : framework desktop sous license Apache-2.0 / MIT.
- **Mnemosys** : License **MIT** (cf. [LICENSE](./LICENSE)).
