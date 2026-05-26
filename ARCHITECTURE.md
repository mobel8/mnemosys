# Architecture — Mnemosys

## Vue d'ensemble

Mnemosys est une application desktop **3-tiers locale**, sans serveur. La séparation des couches est physique (langage et runtime différents) et logique (chaque couche a une responsabilité unique).

```
+--------------------------------------------------------------+
|                  Frontend — WebView (React)                  |
|                                                              |
|  Routes (TanStack Router)                                    |
|     |- index / decks.$deckId / review.$deckId / stats / ...  |
|  Components (shadcn/ui + Radix + Tailwind 4)                 |
|  State :  TanStack Query (serveur)  +  Zustand (client)      |
|  Theme provider (light / dark / system)                      |
+----------------------+---------------------------------------+
                       |
                       |  invoke("command_name", { ... })
                       |  (sérialisation JSON via Tauri IPC)
                       v
+--------------------------------------------------------------+
|              Tauri 2 — bridge IPC + plugins                  |
|                                                              |
|  Plugins enregistrés : fs, dialog, store, notification       |
|  invoke_handler : 25+ #[tauri::command]                      |
|                                                              |
|  NOTE : tauri-plugin-sql n'est PAS utilisé (cf. ADR-2).      |
+----------------------+---------------------------------------+
                       |
                       v
+--------------------------------------------------------------+
|                Backend Rust — `mnemosys_lib`                 |
|                                                              |
|  commands/ : decks, cards, review, stats, demo, io, settings |
|  app_state : AppState { db: Database, scheduler: Mutex<…> }  |
|  db/       : rusqlite + connection pool + repositories       |
|              decks · notes · cards · reviews · params        |
|              + migrations (PRAGMA user_version)              |
|  fsrs/     : wrapper FSRS-6 (params, scheduler, DTOs)        |
|  error     : AppError / AppResult (serde-friendly)           |
+----------------------+---------------------------------------+
                       |
                       v
+--------------------------------------------------------------+
|           SQLite (bundled, ~/.local/share/.../mnemosys.db)   |
|           6 tables + 1 virtual FTS5 + 3 triggers de sync     |
+--------------------------------------------------------------+
```

## Stack détaillée par couche

### Frontend (React / TypeScript)

| Outil | Version | Rôle |
|-------|---------|------|
| React | 19.2 | Runtime UI |
| TypeScript | 6.x | Typage strict (`noUncheckedIndexedAccess`) |
| Vite | 7.3 | Dev server + bundler |
| Tailwind CSS | 4.3 | Styling (plugin `@tailwindcss/vite`) |
| shadcn/ui + Radix UI | – | Composants accessibles |
| TanStack Router | 1.170 | Routing (imperative — cf. ADR-5) |
| TanStack Query | 5.x | Cache + invalidation des appels Tauri |
| Zustand | 5.x | State client (session review en cours) |
| Framer Motion | 12.x | Animations (flip, wizard, ratings) |
| react-hotkeys-hook | 5.x | Raccourcis clavier |
| Recharts | 3.x | Charts du dashboard stats |
| canvas-confetti | 1.9 | Célébration fin de session |
| Biome | 2.x | Lint + format |

### Tauri 2

- Plugins : `tauri-plugin-fs`, `tauri-plugin-dialog`, `tauri-plugin-store`, `tauri-plugin-notification`.
- `tauri-plugin-sql` **n'est pas utilisé** (cf. ADR-2).
- Capabilities : déclarées dans `src-tauri/capabilities/` (file pickers, store).

### Backend Rust

| Crate | Version | Rôle |
|-------|---------|------|
| tauri | 2.x | Shell + IPC |
| rusqlite | 0.39 (`bundled`, `chrono`) | SQLite embarqué |
| fsrs | 5.2 | Algorithme FSRS-6 |
| serde / serde_json | 1.x | Sérialisation (snake_case) |
| chrono | 0.4 | Dates (timestamps `i64` epoch ms) |
| thiserror / anyhow | 2.x / 1.x | Erreurs |
| tokio | 1.x | Runtime async (commandes Tauri) |
| once_cell | 1.x | Lazy statics |
| log | 0.4 | Diagnostics |

## Structure du repo

```
mnemosys/
├── src/                       # Frontend React
│   ├── App.tsx                # Mount QueryClient, Theme, Router, ShortcutsHelp
│   ├── main.tsx               # Bootstrap React
│   ├── routes/                # TanStack Router imperative
│   │   ├── __root.tsx         # Layout (Sidebar + Outlet)
│   │   ├── routeTree.ts       # Composition manuelle des routes
│   │   ├── index.tsx          # Home (decks + KPIs)
│   │   ├── decks.$deckId.tsx  # Détail d'un deck (cartes + stats)
│   │   ├── decks.$deckId.new-card.tsx
│   │   ├── review.$deckId.tsx # Session de review
│   │   ├── stats.tsx          # Dashboard
│   │   └── settings.tsx
│   ├── components/            # Composants métier + ui/ (shadcn)
│   │   ├── stats/             # PeriodSelector, Heatmap, charts
│   │   └── settings/          # Theme, Review, ImportExport, About
│   ├── lib/                   # tauri.ts, queries.ts, theme, format, date
│   │   └── stores/            # Zustand (review session, settings)
│   ├── hooks/
│   ├── types/
│   └── styles/
├── src-tauri/                 # Backend Rust
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── data/demo_decks.json   # 835 cartes embarquées (include_str!)
│   ├── capabilities/          # ACL des plugins Tauri
│   ├── icons/                 # Icônes app
│   └── src/
│       ├── main.rs            # Entry point release
│       ├── lib.rs             # `run()` — builder Tauri + invoke_handler
│       ├── app_state.rs       # AppState (DB + scheduler)
│       ├── error.rs           # AppError / AppResult
│       ├── db/                # rusqlite (pool, migrations, repos)
│       │   ├── mod.rs
│       │   ├── migrations.rs  # PRAGMA user_version, schema.sql embedded
│       │   ├── schema.sql     # v1 — 6 tables + FTS5 + triggers
│       │   ├── decks.rs
│       │   ├── notes.rs
│       │   ├── cards.rs
│       │   ├── reviews.rs
│       │   └── params.rs      # FSRS params storage
│       ├── fsrs/              # Wrapper FSRS-6
│       │   ├── mod.rs
│       │   ├── params.rs      # DEFAULT_PARAMS (21 floats)
│       │   ├── scheduler.rs   # CardScheduler + DTOs sérialisables
│       │   └── tests.rs       # 27 golden tests
│       └── commands/          # #[tauri::command] handlers
│           ├── mod.rs
│           ├── decks.rs       # list, get, create, update, delete, stats
│           ├── cards.rs       # CRUD notes/cards + search FTS
│           ├── review.rs      # due_cards, preview, submit
│           ├── stats.rs       # today, reviews_by_day, retention_by_day
│           ├── demo.rs        # load_demo_decks (idempotent)
│           ├── io.rs          # export_json / import_json
│           └── settings.rs    # get / save AppSettings
├── tests/
│   ├── unit/                  # Vitest + jsdom
│   └── e2e/                   # Playwright
├── public/
├── docs/                      # screenshots (placeholder)
├── README.md
├── ARCHITECTURE.md            # ce fichier
├── USER_GUIDE.md
├── TEST_CHECKLIST.md
├── CONTRIBUTING.md
├── CHANGELOG.md
└── package.json
```

## Modèle de données

### Vue d'ensemble des tables

| Table | Rôle |
|-------|------|
| `decks` | Un deck = une collection de notes. Couleur, description, `desired_retention` propre. |
| `notes` | Contenu d'une carte logique (un template + un blob JSON `fields` + tags). |
| `cards` | Instance « scheduable » d'une note. Une note `basic_reverse` produit 2 cards (ord 0 et 1) ; une note `cloze` produit autant de cards que de `{{cN::…}}` distincts. Porte l'état FSRS (`stability`, `difficulty`, `next_review`, etc.). |
| `reviews` | Journal append-only de chaque review (rating, état avant/après, durée). Source de vérité pour les stats et un futur Optimizer. |
| `fsrs_params` | Singleton (id=1) avec les 21 paramètres FSRS sérialisés en JSON + métadonnées d'optimisation. |
| `notes_fts` | Virtual table FTS5 (tokenize=trigram) synchronisée par triggers — alimente la recherche full-text sur `fields` et `tags`. |

### Schéma DDL (v1, extrait)

```sql
CREATE TABLE decks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    color TEXT NOT NULL DEFAULT '#3b82f6',
    desired_retention REAL NOT NULL DEFAULT 0.9,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    deck_id INTEGER NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
    template TEXT NOT NULL CHECK(template IN ('basic', 'basic_reverse', 'cloze')),
    fields TEXT NOT NULL,       -- JSON blob
    tags TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    deck_id INTEGER NOT NULL REFERENCES decks(id),
    card_ord INTEGER NOT NULL DEFAULT 0,
    state TEXT NOT NULL DEFAULT 'new'
        CHECK(state IN ('new', 'learning', 'review', 'relearning')),
    stability REAL,
    difficulty REAL,
    last_review INTEGER,
    next_review INTEGER,
    elapsed_days INTEGER NOT NULL DEFAULT 0,
    scheduled_days INTEGER NOT NULL DEFAULT 0,
    reps INTEGER NOT NULL DEFAULT 0,
    lapses INTEGER NOT NULL DEFAULT 0,
    suspended INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX idx_cards_due   ON cards(next_review) WHERE suspended = 0;
CREATE INDEX idx_cards_deck  ON cards(deck_id);
CREATE INDEX idx_cards_state ON cards(state) WHERE suspended = 0;

CREATE TABLE reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 4),
    state_before TEXT NOT NULL,
    state_after TEXT NOT NULL,
    stability_before REAL,
    stability_after REAL NOT NULL,
    difficulty_before REAL,
    difficulty_after REAL NOT NULL,
    elapsed_days INTEGER NOT NULL,
    scheduled_days INTEGER NOT NULL,
    review_time INTEGER NOT NULL,
    reviewed_at INTEGER NOT NULL
);

CREATE INDEX idx_reviews_card ON reviews(card_id);
CREATE INDEX idx_reviews_date ON reviews(reviewed_at);

CREATE VIRTUAL TABLE notes_fts USING fts5(
    fields, tags,
    content=notes, content_rowid=id,
    tokenize='trigram'
);
-- + 3 triggers (notes_ai, notes_ad, notes_au) qui répliquent insert/delete/update

CREATE TABLE fsrs_params (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    params_json TEXT NOT NULL,
    optimized_at INTEGER,
    reviews_at_optim INTEGER NOT NULL DEFAULT 0
);
```

### Migrations

- Versionnage via `PRAGMA user_version`.
- Schéma embarqué dans le binaire via `include_str!("schema.sql")`.
- Une migration = une fonction qui bump `user_version` dans une transaction.
- Refus de downgrade : si `user_version > CURRENT_VERSION`, on n'altère pas la base.

## FSRS-6

**Free Spaced Repetition Scheduler (version 6)** est un algorithme open-source de répétition espacée publié par Jarrett Ye (open-spaced-repetition). Il modélise la mémoire à partir de deux variables par carte :

- **stability (S)** : nombre de jours pendant lesquels la rétention reste >= 90 % (intuitivement : la « solidité » de la mémoire).
- **difficulty (D)** : entre 1 (très facile) et 10 (très difficile), capté à partir des ratings passés.

À chaque review, le scheduler met à jour `S` et `D` selon les 21 paramètres calibrés (entraînés sur ~700M de reviews Anki). Le prochain intervalle est calculé pour atteindre la **`desired_retention`** cible (90 % par défaut).

Gain mesuré : **20 à 30 % de reviews en moins** qu'avec SM-2 (l'algorithme historique d'Anki) pour la même rétention. Adopté nativement par Anki en 2024.

Wrapper Rust : `src-tauri/src/fsrs/scheduler.rs` — expose `CardScheduler::new`, `.next_states(memory, elapsed)`, `.apply_review(memory, elapsed, rating)`. Les types renvoyés (`NextStatesDTO`, `MemoryStateDTO`, `ReviewOutcome`) sont serde-friendly, donc traversent l'IPC sans conversion.

Sources :
- [FSRS Wiki — ABC of FSRS](https://github.com/open-spaced-repetition/fsrs4anki/wiki/ABC-of-FSRS)
- [open-spaced-repetition/fsrs-rs (crate)](https://github.com/open-spaced-repetition/fsrs-rs)
- [Article original (Ye, 2023)](https://github.com/open-spaced-repetition/fsrs4anki/wiki)

## Tauri commands

Tous les handlers vivent dans `src-tauri/src/commands/` et sont enregistrés via `tauri::generate_handler![]` dans `lib.rs::run()`. Le frontend les invoque via les wrappers typés de `src/lib/tauri.ts` (`api.<feature>.<command>`).

| Module | Commands | Description |
|--------|----------|-------------|
| `decks` | `list_decks`, `get_deck`, `create_deck`, `update_deck`, `delete_deck`, `get_deck_stats`, `count_decks` | CRUD + agrégats par deck (cards totales, due aujourd'hui, par état). |
| `cards` | `list_cards_in_deck`, `search_notes`, `create_note`, `update_note`, `delete_note`, `suspend_card` | CRUD notes (materializing cards en cascade) + recherche FTS5 + suspension. |
| `review` | `get_due_cards`, `preview_next_states`, `submit_review` | Queue des cartes dues, preview des 4 intervalles, enregistrement d'un review. |
| `stats` | `get_today_stats`, `get_reviews_by_day`, `get_retention_by_day` | KPIs du jour + séries temporelles. |
| `demo` | `load_demo_decks` | Charge les 4 decks démo (idempotent : skip si nom existant). |
| `settings` | `get_settings`, `save_settings` | Lit/écrit `AppSettings` (theme, retention, daily limits, show_next_interval). |
| `io` | `export_json`, `import_json` | Round-trip JSON portable (sans historique de scheduling). |

Convention de nommage côté Rust : `snake_case`. Le wrapper TS expose des paramètres `camelCase` que Tauri convertit automatiquement (`desiredRetention` → `desired_retention`).

## Frontend

### Routing — TanStack Router (imperative)

Pas de file-based codegen (cf. ADR-5). Chaque route exporte un `Route` construit avec `createRoute({ getParentRoute, path, component })` ; `src/routes/routeTree.ts` les compose sous `__root` via `addChildren([...])`.

Routes actuelles : `/`, `/decks/$deckId`, `/decks/$deckId/new-card`, `/review/$deckId`, `/stats`, `/settings`.

### State : Zustand + TanStack Query

- **TanStack Query** : tout ce qui vient du backend (decks, cards, due queue, stats, settings). Les hooks vivent dans `src/lib/queries.ts`, les query keys sont centralisées (`queryKeys.*`) pour des invalidations ciblées. Cache 30 s, pas de retry (IPC local), `refetchOnWindowFocus: false`.
- **Zustand** : state purement client (`src/lib/stores/`).
  - `review.ts` : « une session est en cours ? » + index courant + nombre reviewed, lu par la sidebar pour afficher un pill de progression cross-page.
  - `settings.ts` : draft local des settings avant `Save`.

### Theme provider

`src/lib/theme.tsx` — context custom qui :
1. Lit `AppSettings.theme` au montage (via `useSettingsQuery`).
2. Applique la classe `dark` ou `light` sur `<html>`.
3. Écoute `prefers-color-scheme` si `theme === "system"`.
4. Persiste les changements via `useSaveSettings`.

### Global UX

- `App.tsx` mount un listener `keydown` au niveau `document` pour `?` (toggle help) et les séquences `g h / g s / g p` (navigation), avec un timeout 800 ms entre les deux touches et un opt-out automatique quand le focus est dans un input/textarea/contentEditable.

## Tests

Pyramide délibérément basse (un MVP n'a pas besoin d'une suite massive, mais doit avoir un filet de sécurité sur les points critiques).

| Niveau | Outils | Cible |
|--------|--------|-------|
| **Unit Rust** | `cargo test` | Repositories DB (in-memory SQLite), scheduler FSRS (27 golden tests fixant les paramètres), parsing du payload demo, round-trip import/export. |
| **Unit TS** | Vitest + jsdom + Testing Library | Smoke test du rendu, helpers (`format`, `date`), composants critiques (NoteEditor, ReviewControls, ShortcutsHelp, ImportExport, TodayCard). |
| **E2E** | Playwright | Smoke d'ouverture (Session 1 minimum — l'app boot, sidebar visible). |

Helpers de test : `Database::for_test()` ouvre une base SQLite en mémoire, exécute toutes les migrations, et renvoie un handle prêt à l'emploi. Le frontend mocke `@tauri-apps/api/core` via `tests/setup.ts` lorsque les commandes Tauri ne sont pas instrumentables.

## Build & release

| Commande | Effet |
|----------|-------|
| `pnpm dev` | Vite seul (frontend uniquement, sans Tauri — utile pour des smoke tests rapides en navigateur). |
| `pnpm tauri:dev` | Vite + cargo run en mode debug. Hot-reload côté React, watch sur le code Rust. |
| `pnpm build` | `tsc` (typecheck) + `vite build`. Produit le bundle frontend dans `dist/`. |
| `pnpm tauri:build` | Build de release : bundle frontend optimisé + binaire Rust optimisé + installer natif (`.deb`/`.AppImage`/`.dmg`/`.msi`). Profil release : `opt-level = "s"`, `lto = true`, `codegen-units = 1`, `panic = "abort"`, `strip = true`. |

## Décisions architecturales (ADR-list courte)

### ADR-1 — Tauri 2 plutôt qu'Electron
- **Pourquoi** : bundle ~30× plus petit (8 Mo vs 250 Mo pour un Hello World), démarrage instantané (binaire Rust natif vs Chromium embarqué), surface d'attaque réduite (WebView système, pas de Node.js dans le process renderer), capabilities-based security.
- **Trade-off** : WebKit (Linux/macOS) ou WebView2 (Windows) au lieu de Chromium — quelques différences CSS/JS mineures à gérer.

### ADR-2 — rusqlite plutôt que tauri-plugin-sql
- **Pourquoi** : `tauri-plugin-sql` dépend de `sqlx`, qui réclame `libsqlite3-sys` à une version qui entre en conflit avec celle de `rusqlite` (deux liens natifs sur la même libsqlite3 → erreur de linkage). On voulait `rusqlite` pour son ergonomie « close au SQL » et son support FTS5/trigram natif.
- **Trade-off** : on doit exposer manuellement chaque opération DB via une `#[tauri::command]`. Bénéfice secondaire : le frontend ne touche jamais SQL directement, ce qui élimine toute classe de vulnérabilités d'injection.

### ADR-3 — FSRS-6 plutôt que SM-2
- **Pourquoi** : 20 à 30 % de reviews en moins pour la même rétention (étude open-spaced-repetition sur 700M reviews). Adopté nativement par Anki en 2024. Modèle plus riche (stabilité + difficulté) qu'un simple facteur d'ease.
- **Trade-off** : 21 paramètres à calibrer (vs 1 facteur ease). Pour le MVP on utilise les paramètres par défaut entraînés sur la population globale ; un Optimizer personnalisé arrivera en Session 4.

### ADR-4 — Vite 7 plutôt que Vite 8
- **Pourquoi** : Vite 8 (beta au moment du build de la stack) + le bundler `rolldown` + le plugin `@tailwindcss/vite` ont un bug de résolution qui casse le build Tailwind. Vite 7 stable + esbuild traditionnel fonctionne parfaitement.
- **Trade-off** : on rate les gains de perf de Rolldown (~2-3× plus rapide en bundling). À réévaluer en Session 4 quand l'écosystème sera stabilisé.

### ADR-5 — Routing imperative TanStack Router plutôt que file-based
- **Pourquoi** : le file-based router de TanStack Router v1 nécessite un plugin Vite (`@tanstack/router-plugin`) qui ajoute un code-gen avec un cycle dev-server-restart non négligeable et un risque de désynchronisation entre les agents qui itèrent vite. L'imperative API (`createRoute` + `addChildren`) tient en 30 lignes pour 6 routes.
- **Trade-off** : pas d'auto-complétion des paths basée sur le filesystem. Acceptable à 6 routes ; à reconsidérer si l'arbre dépasse 20 routes (Session 2 ou 3).
