# Architecture — Mnemosys

## Vue d'ensemble

Mnemosys est une application desktop **3-tiers locale**, sans serveur. La séparation des couches est physique (langage et runtime différents) et logique (chaque couche a une responsabilité unique).

```
+--------------------------------------------------------------+
|                  Frontend — WebView (React)                  |
|                                                              |
|  Routes (TanStack Router) — 22                               |
|     |- index / decks.$deckId(+/new-card) / review.$deckId    |
|     |- review-interleaved / ai-generate / achievements       |
|     |- palaces(+$id+/review) / graph / stats / settings      |
|     |- music / gesture / shadowing / reading                 |
|     |- planner / mnemonics                                    |
|  Components (shadcn/ui + Radix + Tailwind 4 + R3F 3D)        |
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
|  Plugins : fs, dialog, store, notification, updater          |
|  invoke_handler : ~95 #[tauri::command]                      |
|                                                              |
|  NOTE : tauri-plugin-sql n'est PAS utilisé (cf. ADR-2).      |
+----------------------+---------------------------------------+
                       |
                       v
+--------------------------------------------------------------+
|                Backend Rust — `mnemosys_lib`                 |
|                                                              |
|  commands/ : decks cards review stats demo io settings tts   |
|              ai apkg media sync fsrs_optimizer gamification   |
|              cognitive wellness sketches metacognition        |
|              podcast whisper palaces subtitles               |
|              mastery plans reading                            |
|  app_state : AppState { db: Database, scheduler: Mutex<…> }  |
|  db/       : rusqlite + connection pool + repositories       |
|  fsrs/     : wrapper FSRS-6 + optimize (calibration)         |
|  scheduler/: trait pluggable (fsrs6 sm2 leitner hlr memorize) |
|  ai/ tts/ apkg/ subtitles/ sync/  (feature modules)         |
|  error     : AppError / AppResult (serde-friendly)           |
+----------------------+---------------------------------------+
                       |
                       v
+--------------------------------------------------------------+
|           SQLite (bundled, ~/.local/share/.../mnemosys.db)   |
|     schema v19 — FSRS-6 unique (v19 migre les decks legacy)  |
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
| three / @react-three/fiber / drei | 0.184 / 9.6 / 10.7 | Memory Palace 3D (WebGL, V9 — cf. ADR-8) |
| Biome | 2.x | Lint + format |

### Tauri 2

- Plugins : `tauri-plugin-fs`, `tauri-plugin-dialog`, `tauri-plugin-store`, `tauri-plugin-notification`, `tauri-plugin-updater` (Session 4, **dormant** tant que `endpoints`/`pubkey` ne pointent pas vers un serveur de manifeste réel — cf. `docs/SESSION_4_RELEASE.md`).
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
│       │   ├── migrations.rs  # PRAGMA user_version, schema_vN.sql embedded
│       │   ├── schema.sql     # v1 ; schema_v4..v11.sql pour les migrations
│       │   ├── decks.rs notes.rs cards.rs reviews.rs params.rs
│       │   ├── gamification.rs metacognition.rs wellness.rs
│       │   ├── sketches.rs palaces.rs              # repos Vagues 7/9
│       │   └── reading.rs plans.rs                 # repos word_status (v14) / study_plans (v16)
│       ├── fsrs/              # Wrapper FSRS-6
│       │   ├── params.rs      # DEFAULT_PARAMS (21 floats)
│       │   ├── scheduler.rs   # CardScheduler + DTOs sérialisables
│       │   ├── optimize.rs    # calibration (MIN_REVIEWS_FOR_OPTIM = 1000)
│       │   └── tests.rs       # 27 golden tests
│       ├── scheduler/         # trait pluggable (ADR-6, ADR-10)
│       │   ├── fsrs6_adapter.rs sm2.rs leitner.rs hlr.rs memorize.rs
│       ├── ai/                # Claude/Ollama : cards, pdf, critic, mnemonic, podcast, image
│       ├── tts/               # OpenAI + Piper local TTS + cache + podcast + whisper
│       ├── apkg/              # importeur .apkg (parser + converter)
│       ├── subtitles/         # parser .srt / .vtt
│       ├── sync/              # Supabase (client, auth, delta, apply, cycle)
│       └── commands/          # #[tauri::command] handlers (~95, 1 fichier/feature)
│           ├── decks.rs cards.rs review.rs stats.rs demo.rs io.rs settings.rs
│           ├── tts.rs ai.rs apkg.rs media.rs sync.rs fsrs_optimizer.rs
│           ├── gamification.rs cognitive.rs wellness.rs sketches.rs
│           ├── metacognition.rs podcast.rs whisper.rs palaces.rs subtitles.rs
│           └── mastery.rs plans.rs reading.rs   # BKT/timeline (V20/23), plans (V21), reading (V17)
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
| `sync_state` | Singleton (id=1) — curseur de sync cloud (`last_sync_at`, `user_id`). Session 3. |
| `user_stats` | Singleton (id=1) — gamification : streak courant/best, inventaire de freezes mensuels, compteurs lifetime. Vague 1. |
| `achievements` | Badges débloqués (`code` slug unique + `unlocked_at`). Vague 1. |
| `wellness_logs` | Check-ins pré-session opt-in (humeur, sommeil, stress, hydratation, caféine). Toutes colonnes NULL-ables. Vague 3. |
| `review_sketches` | Croquis PNG (data URL) capturés avant flip, keyés par `review_id`. Drawing effect. Vague 7. |
| `jol_predictions` | Prédictions de rappel différées (`predicted_prob`, `actual_correct` résolu à la review suivante). Calibration γ. Vague 7. |
| `palaces` | Un palais de mémoire (nom + template 3D house/street/castle/custom). Vague 9. |
| `palace_loci` | Épingle une carte à une position `(x, y, z)` + `ordinal` (ordre du parcours) dans un palais. Vague 9. |
| `word_status` | Statut de connaissance par mot (`new`/`learning`/`known`), clé composite `(word, language)`. Reading Import LingQ-style. Vague 17. |
| `study_plans` | Implementation intentions « si [trigger] alors [action] » (`time`/`place`/`after_habit` + jours + deck optionnel). Vague 21. |

**Colonnes ajoutées par migration** (ALTER TABLE) : `decks.remote_id` (v3), `decks.scheduler_kind` (v7), `decks.language_mode` (v11), `decks.prerequisite_deck_id` (v13, mastery gating), `notes.remote_id` (v3), `notes.frequency_band` (v11), `cards.remote_id` (v3), `reviews.confidence` (v5), `reviews.confidence_post` (v13, confiance rétrospective). Le `notes.template` CHECK est étendu progressivement : v2 (`occlusion`), v11 (`sentence`, `bidirectional`), v12 (`illness_script`, `refutation`), v13 (`worked_example`) — **9 valeurs au total**. Le `decks.scheduler_kind` CHECK est étendu en v15 (`hlr`, `memorize`).

### Schéma DDL — base v1 (extrait)

> Ci-dessous le schéma initial v1. Les tables ajoutées par les migrations v3→v11 sont documentées plus bas (*DDL des migrations*).

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

### DDL des migrations (v3 → v11, extrait)

```sql
-- v3 (Session 3 — sync) : remote_id sur decks/notes/cards + curseur de sync.
CREATE TABLE sync_state (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    last_sync_at INTEGER,
    user_id TEXT
);

-- v4 (Vague 1 — gamification White Hat).
CREATE TABLE user_stats (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    streak_current INTEGER NOT NULL DEFAULT 0,
    streak_best INTEGER NOT NULL DEFAULT 0,
    last_review_date TEXT,                        -- ISO 'YYYY-MM-DD'
    freeze_remaining INTEGER NOT NULL DEFAULT 2,  -- freezes ce mois
    freeze_month TEXT,                            -- ISO 'YYYY-MM' (reset mensuel)
    total_reviews INTEGER NOT NULL DEFAULT 0,
    total_correct INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE achievements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,                     -- 'first_review', 'streak_7'…
    unlocked_at INTEGER NOT NULL
);

-- v5 (Vague 2) : confidence-based marking, NULL-able pour rétro-compat.
ALTER TABLE reviews ADD COLUMN confidence INTEGER;   -- [1..5]

-- v6 (Vague 3 — neuro modes opt-in). Toutes colonnes NULL-ables.
CREATE TABLE wellness_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,                            -- ISO 'YYYY-MM-DD'
    mood INTEGER, sleep_hours REAL, stress_level INTEGER,
    hydrated BOOLEAN NOT NULL DEFAULT 0,
    caffeine_taken BOOLEAN NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);

-- v7 (Vague 4 — schedulers pluggables). 12-step recipe pour le CHECK.
ALTER TABLE decks ADD COLUMN scheduler_kind TEXT NOT NULL DEFAULT 'fsrs6'
    CHECK(scheduler_kind IN ('fsrs6', 'sm2', 'leitner'));

-- v8 (Vague 7 — drawing effect). Un croquis PNG par review.
CREATE TABLE review_sketches (
    review_id INTEGER PRIMARY KEY REFERENCES reviews(id) ON DELETE CASCADE,
    card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    sketch_data TEXT NOT NULL,                     -- data:image/png;base64,…
    created_at INTEGER NOT NULL
);

-- v9 (Vague 7 — delayed JOL). actual_correct résolu à la review suivante.
CREATE TABLE jol_predictions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    predicted_at INTEGER NOT NULL,
    predicted_prob REAL NOT NULL,                  -- [0.0, 1.0]
    prediction_horizon_days INTEGER NOT NULL DEFAULT 7,
    actual_correct INTEGER,                        -- 1 / 0 / NULL=pending
    resolved_at INTEGER
);

-- v10 (Vague 9 — Memory Palace 3D).
CREATE TABLE palaces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    template TEXT NOT NULL DEFAULT 'house'
        CHECK(template IN ('house', 'street', 'castle', 'custom')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE TABLE palace_loci (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    palace_id INTEGER NOT NULL REFERENCES palaces(id) ON DELETE CASCADE,
    card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    x REAL NOT NULL, y REAL NOT NULL, z REAL NOT NULL,
    ordinal INTEGER NOT NULL,
    label TEXT,
    created_at INTEGER NOT NULL,
    UNIQUE(palace_id, card_id)
);

-- v11 (Vague 10 — Mode Langue). 12-step recipe : étend le CHECK template
-- ('sentence', 'bidirectional') et ajoute frequency_band ; + language_mode sur decks.
ALTER TABLE decks ADD COLUMN language_mode TEXT;     -- ISO 639-1 ou NULL
-- notes reconstruite avec :
--   template CHECK(... 'sentence', 'bidirectional')
--   frequency_band TEXT CHECK(NULL OR IN ('top_100','top_1k','top_5k','top_10k','beyond'))

-- v12 (Vague 14 — modes disciplinaires). 12-step recipe : étend le CHECK
-- template avec 'illness_script' (médecine, Charlin 2007) et 'refutation'
-- (sciences, Tippett 2010). Rebuild notes + FTS5 + triggers.

-- v13 (Vague 15) : trois changements couplés.
-- 1. 12-step recipe : étend le CHECK template avec 'worked_example' (maths,
--    Sweller/Renkl/Atkinson 2003). Le CHECK final liste les 9 valeurs :
--    'basic','basic_reverse','cloze','occlusion','sentence','bidirectional',
--    'illness_script','refutation','worked_example'.
-- 2. mastery gating (Bloom) :
ALTER TABLE decks ADD COLUMN prerequisite_deck_id INTEGER REFERENCES decks(id);
-- 3. confiance rétrospective (Bang & Fleming 2018) :
ALTER TABLE reviews ADD COLUMN confidence_post INTEGER;   -- [1..5], NULL-able

-- v14 (Vague 17 — Reading Import). Additif pur, pas de rebuild.
CREATE TABLE word_status (
    word TEXT NOT NULL,                            -- lower-cased, trimmé par le repo
    language TEXT NOT NULL,                        -- ISO 639-1 ('en', 'ja', …) ou ''
    status TEXT NOT NULL CHECK(status IN ('new', 'learning', 'known')),
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (word, language)
);
CREATE INDEX idx_word_status_lang ON word_status(language);

-- v15 (Vague 20 — schedulers avancés). 12-step recipe : élargit le CHECK de
-- decks.scheduler_kind à ('fsrs6','sm2','leitner','hlr','memorize').
-- language_mode (v11) et prerequisite_deck_id (v13) sont recopiés verbatim.

-- v16 (Vague 21 — Implementation Intentions). Additif pur.
CREATE TABLE study_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trigger_type TEXT NOT NULL
        CHECK(trigger_type IN ('time', 'place', 'after_habit')),
    trigger_value TEXT NOT NULL,
    action TEXT NOT NULL,
    deck_id INTEGER,                               -- soft ref (PAS de FK : un deck supprimé ne drop pas le plan)
    days TEXT NOT NULL DEFAULT '[]',               -- JSON array d'ISO weekday ints (1=lun … 7=dim) ; [] = tous les jours
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
);
```

### Migrations

- Versionnage via `PRAGMA user_version`. **Version courante : v19** (`CURRENT_VERSION` dans `migrations.rs` ; v17 = FK hardening, v18 = index covering dû, v19 = conversion de tous les decks vers FSRS-6).
- Chaque migration est embarquée dans le binaire (`include_str!` d'un `schema_vN.sql`, ou littéral inline pour v2/v7/v15/v16) et appliquée conditionnellement (`if current < N`) dans une transaction (bump du `user_version` + COMMIT, ROLLBACK best-effort en cas d'échec).
- **Refus de downgrade** : si `user_version > CURRENT_VERSION`, on n'altère pas la base (un build futur a ouvert ce fichier).
- SQLite n'a pas d'`ALTER … DROP/ADD CONSTRAINT` : modifier un CHECK suit la **« 12-step recipe »** (recréer la table, copier les rows, renommer, reconstruire FTS5 + triggers). Utilisé en v2, v7, v11, v12, v13 (template CHECK) et v15 (scheduler_kind CHECK).

| Version | Vague / Session | Changement |
|---------|-----------------|------------|
| v1 | Session 1 | Schéma initial (6 tables + FTS5 + 3 triggers). |
| v2 | Session 2 | `notes.template` CHECK accepte `occlusion`. |
| v3 | Session 3 | `remote_id` (decks/notes/cards) + `sync_state`. |
| v4 | Vague 1 | `user_stats` + `achievements`. |
| v5 | Vague 2 | `reviews.confidence` (CBM). |
| v6 | Vague 3 | `wellness_logs`. |
| v7 | Vague 4 | `decks.scheduler_kind` (fsrs6/sm2/leitner). |
| v8 | Vague 7 | `review_sketches` (drawing effect). |
| v9 | Vague 7 | `jol_predictions` (delayed JOL / calibration). |
| v10 | Vague 9 | `palaces` + `palace_loci` (Memory Palace). |
| v11 | Vague 10 | templates `sentence`/`bidirectional` + `notes.frequency_band` + `decks.language_mode`. |
| v12 | Vague 14 | templates `illness_script`/`refutation` (modes disciplinaires). |
| v13 | Vague 15 | template `worked_example` + `decks.prerequisite_deck_id` (mastery gating) + `reviews.confidence_post`. |
| v14 | Vague 17 | `word_status` (Reading Import LingQ-style). |
| v15 | Vague 20 | `decks.scheduler_kind` élargi à `hlr`/`memorize`. |
| v16 | Vague 21 | `study_plans` (implementation intentions). |

## FSRS-6

**Free Spaced Repetition Scheduler (version 6)** est un algorithme open-source de répétition espacée publié par Jarrett Ye (open-spaced-repetition). Il modélise la mémoire à partir de deux variables par carte :

- **stability (S)** : nombre de jours pendant lesquels la rétention reste >= 90 % (intuitivement : la « solidité » de la mémoire).
- **difficulty (D)** : entre 1 (très facile) et 10 (très difficile), capté à partir des ratings passés.

À chaque review, le scheduler met à jour `S` et `D` selon les 21 paramètres calibrés (entraînés sur ~700M de reviews Anki). Le prochain intervalle est calculé pour atteindre la **`desired_retention`** cible (90 % par défaut).

Gain mesuré : **20 à 30 % de reviews en moins** qu'avec SM-2 (l'algorithme historique d'Anki) pour la même rétention. Adopté nativement par Anki en 2024.

Wrapper Rust : `src-tauri/src/fsrs/scheduler.rs` — expose `CardScheduler::new`, `.next_states(memory, elapsed)`, `.apply_review(memory, elapsed, rating)`. Les types renvoyés (`NextStatesDTO`, `MemoryStateDTO`, `ReviewOutcome`) sont serde-friendly, donc traversent l'IPC sans conversion.

**Optimizer (Session 4)** : `src-tauri/src/fsrs/optimize.rs` recalibre les 21 paramètres par descente de gradient sur l'historique local (`reviews`), au-delà de `MIN_REVIEWS_FOR_OPTIM = 1000` (seuil Ye et al., SIGKDD 2022). Les nouveaux paramètres sont persistés dans `fsrs_params`.

**Schedulers pluggables (Vagues 4 & 20)** : `src-tauri/src/scheduler/` définit un trait commun et **cinq** implémentations — `fsrs6_adapter` (défaut), `sm2`, `leitner` (V4), `hlr` (Half-Life Regression, Settles & Meeder 2016) et `memorize` (contrôle optimal, Tabibian et al. 2019) (V20) — choisies par deck via `decks.scheduler_kind`. Voir ADR-6 et ADR-10.

Sources :
- [FSRS Wiki — ABC of FSRS](https://github.com/open-spaced-repetition/fsrs4anki/wiki/ABC-of-FSRS)
- [open-spaced-repetition/fsrs-rs (crate)](https://github.com/open-spaced-repetition/fsrs-rs)
- [Article original (Ye, 2023)](https://github.com/open-spaced-repetition/fsrs4anki/wiki)

## Tauri commands

Tous les handlers vivent dans `src-tauri/src/commands/` et sont enregistrés via `tauri::generate_handler![]` dans `lib.rs::run()`. Le frontend les invoque via les wrappers typés de `src/lib/tauri.ts` (`api.<feature>.<command>`).

L'`invoke_handler` enregistre **~55 commandes** (v0.11 a supprimé sync, wellness, palaces, JOL et 2 commandes mortes). Regroupées par module / feature :

| Module | Commands | Feature |
|--------|----------|---------|
| `decks` | `list_decks`, `get_deck`, `create_deck`, `update_deck`, `delete_deck`, `get_deck_stats`, `count_decks`, `get_deck_mastery` | CRUD + agrégats + maîtrise WaniKani 5-stages (V1). |
| `cards` | `list_cards_in_deck`, `search_notes`, `create_note`, `update_note`, `delete_note`, `suspend_card`, `reset_card`, `get_frequency_coverage`, `get_tag_graph` | CRUD notes/cards + FTS5 + reset FSRS (S2) + couverture fréquence (V10) + graphe de tags (V11). |
| `review` | `get_due_cards`, `get_interleaved_due_cards`, `preview_next_states`, `submit_review` | Queue due, file entrelacée multi-decks (V5), preview, submit. |
| `stats` | `get_today_stats`, `get_reviews_by_day`, `get_retention_by_day` | KPIs + séries temporelles. |
| `demo` | `load_demo_decks` | Charge les 4 decks démo (idempotent). |
| `settings` | `get_settings`, `save_settings` | Lit/écrit `AppSettings` (incl. tous les toggles V2/V3/V7/V8/V12). |
| `io` | `export_json`, `import_json` | Round-trip JSON portable. |
| `subtitles` | `import_subtitles` | Import `.srt`/`.vtt` → cartes phrase/cloze (V11). |
| `tts` | `synthesize_audio`, `synthesize_audio_local`, `clear_tts_cache`, `get_tts_cache_size` | TTS OpenAI + cache disque (S2) ; moteur **Piper local** (V22). |
| `ai` | `generate_cards_text`, `generate_cards_local`, `generate_cards_pdf`, `generate_card_elaboration`, `critique_generated_cards`, `generate_card_mnemonic`, `generate_card_mnemonic_image` | Génération Claude texte/PDF (S2), génération **Ollama locale** (V18), élaboration Why/Example (V5), critic multi-agent + mnémotechnique (V13), **image mnémotechnique DALL-E** (V22). |
| `apkg` | `import_apkg` | Import paquet Anki `.apkg` (S2). |
| `media` | `copy_image_to_app_data` | Copie image pour template occlusion (S2). |
| `sync` | `sync_login`, `sync_logout`, `sync_status`, `sync_now` | Sync cloud Supabase (S3, dormante). |
| `fsrs_optimizer` | `get_total_reviews_count`, `optimize_fsrs_params` | Calibration des 21 params (S4). |
| `gamification` | `get_user_stats`, `use_streak_freeze`, `list_unlocked_achievements` | Streaks, freezes, badges (V1). |
| `cognitive` | `generate_pre_questions` | Pré-questionnement IA (V2). |
| `wellness` | `submit_wellness_log`, `get_today_wellness`, `get_recent_wellness` | Check-ins neuro opt-in (V3). |
| `sketches` | `save_sketch`, `get_card_sketches` | Croquis drawing effect (V7). |
| `metacognition` | `record_jol`, `get_pending_jols`, `get_calibration_stats` | JOL différés + calibration γ (V7). |
| `podcast` | `generate_deck_podcast`, `list_deck_podcasts`, `delete_podcast` | Deck Podcast 2 voix (V8). |
| `whisper` | `transcribe_voice_answer` | Réponse vocale Whisper (V8). |
| `palaces` | `list_palaces`, `get_palace`, `create_palace`, `update_palace`, `delete_palace`, `add_palace_locus`, `remove_palace_locus`, `reorder_palace_loci`, `move_palace_locus` | Memory Palace 3D : palais + loci (V9). |
| `mastery` | `get_concept_mastery`, `get_mastery_timeline` | Maîtrise par tag : BKT instantané (V20) + Temporal Mastery Graph (V23). |
| `plans` | `list_study_plans`, `create_study_plan`, `update_study_plan`, `toggle_study_plan`, `delete_study_plan` | Implementation intentions / planificateur (V21). |
| `reading` | `get_word_statuses`, `set_word_status`, `create_cards_from_words` | Reading Import LingQ-style : statut par mot + génération de cartes (V17). |

> Le `mastery gating` (V15) ne crée pas de commande dédiée : le déblocage est calculé côté `decks` (rétention du deck prérequis) et exposé via `get_deck`/`get_deck_stats`.

Convention de nommage côté Rust : `snake_case`. Le wrapper TS expose des paramètres `camelCase` que Tauri convertit automatiquement (`desiredRetention` → `desired_retention`).

## Frontend

### Routing — TanStack Router (imperative)

Pas de file-based codegen (cf. ADR-5). Chaque route exporte un `Route` construit avec `createRoute({ getParentRoute, path, component })` ; `src/routes/routeTree.ts` les compose sous `__root` via `addChildren([...])`.

Routes actuelles (22, composées dans `routeTree.ts`) :

| Route | Page | Feature |
|-------|------|---------|
| `/` | Home (decks + KPIs) | S1 |
| `/decks/$deckId` | Détail deck (cartes, stats, podcast via kebab, couverture fréquence si langue, image mnémotechnique via kebab carte) | S1 + V8/V10/V22 |
| `/decks/$deckId/new-card` | Éditeur de note (Basic / Reverse / Cloze / Occlusion / Phrase / Médecine / Sciences / Maths) | S1 + S2 + V10 + V14/V15 |
| `/review/$deckId` | Session de review (+ sketch, JOL, Whisper, pré-test, auto-explication, Focus Guard, confiance post, mains-libres selon toggles) | S1 + V2/V7/V8/V12/V15/V23 |
| `/review-interleaved` | Review entrelacée multi-decks | V5 |
| `/ai-generate` | Génération IA de cartes (Claude ou Ollama local, + critic opt-in) | S2 + V13/V18 |
| `/palaces` | Liste des palais de mémoire | V9 |
| `/palaces/$palaceId` | Builder 3D (placement de loci) | V9 |
| `/palaces/$palaceId/review` | Parcours 3D (mode review WASD/ZQSD) | V9 |
| `/stats` | Dashboard (+ Calibration métacognitive + γ_post + maîtrise concepts BKT + Temporal Mastery Graph) | S1 + V7/V20/V22/V23 |
| `/graph` | Graphe de connaissances (co-occurrence de tags) | V11 |
| `/achievements` | Succès, streak, maîtrise des decks | V1 |
| `/music` | Mode Musique (métronome + ear training, Web Audio) | V16 |
| `/gesture` | Gesture drawing timer (Canvas) | V16 |
| `/shadowing` | Shadowing (waveforms TTS vs voix) | V17 |
| `/reading` | Reading Import LingQ-style (statut par mot) | V17 |
| `/planner` | Planning — implementation intentions | V21 |
| `/mnemonics` | Major System / PAO | V21 |
| `/settings` | Paramètres (sections, cf. ci-dessous) | S1+ |

La page **Settings** empile : Theme · Review (incl. tous les Modes cognitifs V2/V7/V8/V12, confiance post V15) · FSRS Optimizer · Integrations (clés API, voix TTS OpenAI **et Piper local**, URL/modèle **Ollama**) · Neuro modes (V3 + chronotype rMEQ et son d'ambiance V18) · Sync (S3) · Import/Export (incl. import sous-titres V11) · About.

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
- **Trade-off** : pas d'auto-complétion des paths basée sur le filesystem. Acceptable à 6 routes ; à reconsidérer si l'arbre dépasse 20 routes (Session 2 ou 3). **Mise à jour** : à **22 routes** le seuil annoncé est franchi, mais `routeTree.ts` reste un simple `addChildren([...])` à plat (pas de hiérarchie profonde hormis `palaces/$id/review`), donc lisible et sans codegen. Décision **maintenue** pour l'instant ; le file-based router redevient une option si une imbrication réelle (layouts multiples) apparaît.

### ADR-6 — Schedulers pluggables via un trait Rust (Vague 4)
- **Pourquoi** : permettre à chaque deck de choisir son algorithme (FSRS-6 / SM-2 / Leitner) sans dupliquer la logique de review. On définit un **trait** commun dans `src-tauri/src/scheduler/` (next-states + apply-review) ; le dispatcher lit `decks.scheduler_kind` et instancie la bonne implémentation. FSRS-6 reste l'adaptateur par défaut.
- **Trade-off** : une couche d'indirection en plus, et trois algorithmes à maintenir/tester au lieu d'un. Le CHECK constraint sur `scheduler_kind` (appliqué via la 12-step recipe en v7) garantit qu'aucune valeur hors-bande ne wedge le dispatcher. Bénéfice : extensibilité (un futur SM-18 ou Anki-SM-2 exact s'ajoute sans toucher au reste).

### ADR-7 — Focus Guard local-first (WebGazer) plutôt que cloud (Vague 12)
- **Pourquoi** : la détection de *mind-wandering* par webcam (Hutt et al. 2024) est une fonctionnalité à très forte sensibilité vie privée. On utilise **WebGazer.js**, qui fait tourner l'eye-tracking **entièrement dans la WebView** : aucune image ni flux vidéo ne quitte la machine, rien n'est persisté. Un consentement explicite est demandé au premier lancement et la feature est **opt-in** (off par défaut).
- **Trade-off** : précision moindre qu'un modèle serveur entraîné, et coût CPU non négligeable pendant la session. Acceptable : le signal n'a pas besoin d'être parfait pour une simple relance d'attention, et le « zéro réseau » est non négociable pour de la webcam. Cohérent avec le principe local-first de l'app (ADR-1).

### ADR-8 — Memory Palace 3D via React Three Fiber + primitives (Vague 9)
- **Pourquoi** : rendre un palais de mémoire navigable en 3D dans une WebView. On utilise **React Three Fiber** (réconciliateur React pour three.js) + **drei** pour les helpers (OrbitControls, Sky, Text). Les trois templates (house/street/castle) sont construits avec des **primitives géométriques** (plans, boîtes, cylindres) — **aucun asset GLTF** à charger, donc rien à bundler ni à streamer, et un boot instantané.
- **Trade-off** : esthétique volontairement minimaliste (pas de meshes détaillés). Le composant détecte l'absence de WebGL (jsdom/CI/headless) et affiche un fallback HTML pour rester montable en test sans mocks lourds. `custom` retombe sur `house` en attendant un support GLTF ultérieur.

### ADR-9 — Pipeline multi-agent Generator → Critic (Vague 13)
- **Pourquoi** : améliorer la qualité des cartes générées sans intervention manuelle. Après la passe *Generator*, un **second appel Claude** (le *Critic*) note chaque carte `[0, 1]` et propose une correction pour les cartes sous le seuil `QUALITY_THRESHOLD = 0.7`. Le pattern « générer puis critiquer » exploite le fait qu'évaluer est plus facile que produire.
- **Trade-off** : un appel API supplémentaire (coût + latence) — donc **opt-in** (case à cocher off par défaut) et **purement additif** : si le critic échoue ou est désactivé, les brouillons restent utilisables sans score. Le verdict est consultatif, jamais bloquant. Même philosophie pour l'**Aide mnémotechnique** (générée à la demande, uniquement pour les cartes à `lapses ≥ 3`).

### ADR-10 — Schedulers HLR & MEMORIZE ajoutés au trait pluggable (Vague 20)
- **Pourquoi** : le trait `Scheduler` posé en V4 (ADR-6) était conçu pour être extensible ; on l'a vérifié en ajoutant deux algorithmes de la littérature sans toucher au dispatcher ni au flux de review. **HLR** (Half-Life Regression, Settles & Meeder 2016, le modèle derrière Duolingo) estime la demi-vie de la mémoire par régression ; **MEMORIZE** (Tabibian et al. 2019, PNAS) dérive un espacement par contrôle optimal stochastique. Chacun est une simple `impl Scheduler` dans `src-tauri/src/scheduler/` (`hlr.rs`, `memorize.rs`).
- **Trade-off** : deux algos de plus à maintenir/tester, et le CHECK `scheduler_kind` a dû être élargi (migration v15, 12-step recipe). Bénéfice : la promesse d'extensibilité d'ADR-6 est tenue — 5 algorithmes coexistent, choisis par deck, sans code conditionnel dans la boucle de review. Validation a posteriori du choix « trait + dispatcher » plutôt qu'un `match` hard-codé.

### ADR-11 — BKT plutôt que DKT pour la maîtrise des concepts (Vague 20)
- **Pourquoi** : estimer la maîtrise par tag demande un modèle de *knowledge tracing*. On a choisi **Bayesian Knowledge Tracing** (BKT, Corbett & Anderson 1994) — un HMM à 4 paramètres (prior, learn, guess, slip) — plutôt que **Deep Knowledge Tracing** (DKT, réseau récurrent). BKT est **interprétable** (un % de maîtrise par concept directement lisible), **léger** (calculable en Rust sans dépendance ML, pas de tenseurs ni de GPU), **local** (cohérent avec ADR-1), et **honnête à faible volume** : il donne une estimation utile dès quelques reviews, là où un RNN exige des milliers d'exemples pour ne pas sur-apprendre.
- **Trade-off** : BKT suppose l'indépendance des concepts (pas de prérequis modélisés entre tags) et une maîtrise binaire par skill — moins fin qu'un DKT bien entraîné qui capte les corrélations inter-concepts. Acceptable : pour un outil personnel mono-utilisateur, l'interprétabilité et le coût nul priment sur le dernier point d'AUC. Le *mastery gating* (V15) couvre séparément les prérequis explicites entre decks.

### ADR-12 — Moteurs IA locaux (Ollama, Piper) en alternative au cloud (Vagues 18 & 22)
- **Pourquoi** : la génération de cartes (Claude) et la synthèse vocale (OpenAI) étaient les seules dépendances réseau du parcours d'apprentissage. Pour rester fidèle au principe local-first (ADR-1) et offrir un mode **zéro-coût / zéro-réseau / hors-ligne**, on a ajouté des back-ends locaux interchangeables : **Ollama** (`generate_cards_local`) pour les LLM, **Piper** (`synthesize_audio_local`) pour le TTS. Le choix du moteur est un réglage ; le reste de l'app (cache disque, UI) est identique quel que soit le back-end.
- **Trade-off** : l'utilisateur doit installer et faire tourner Ollama/Piper lui-même (dépendances externes non bundlées, pour ne pas alourdir l'installateur ni embarquer des poids de modèles de plusieurs Go), et la qualité dépend du modèle local choisi (souvent en deçà de Claude/OpenAI). Bénéfice : confidentialité totale (contenu sensible qui ne sort jamais), aucun coût d'API, fonctionne en avion. Les moteurs cloud restent disponibles pour qui privilégie la qualité.

### ADR-13 — Mode mains-libres : composition de briques existantes (Vague 23)
- **Pourquoi** : permettre une review **sans écran ni clavier** (en marchant, en cuisinant). Plutôt qu'un nouveau pipeline, le mode mains-libres **orchestre des briques déjà présentes** : TTS (OpenAI ou Piper) pour lire question puis réponse, et Whisper pour transcrire à la fois la réponse *et* le rating dits à voix haute. Aucune nouvelle table ni commande : c'est une couche d'orchestration côté frontend au-dessus de `synthesize_audio*` et `transcribe_voice_answer`.
- **Trade-off** : latence cumulée (synthèse → écoute → transcription) plus élevée qu'un clic, et dépendance aux mêmes clés/back-ends que TTS+Whisper (ou Piper local pour la sortie). Le rating vocal tolère un vocabulaire fermé (« again/hard/good/easy » + synonymes) pour limiter les erreurs de transcription. Bénéfice : réutilisation maximale, surface de code minimale, et transformation de temps morts en révision.

## Évolution : Sessions 1-4 + Vagues 1-23

L'app est partie d'un MVP SRS local (S1) et s'est étendue par **sessions** (gros chantiers transverses) puis par **vagues** (features ciblées, souvent adossées à un résultat scientifique). Résumé :

| Lot | Apport | Impact technique |
|-----|--------|------------------|
| **Session 1** | FSRS-6, CRUD decks/notes/cards (basic/reverse/cloze), review, stats, import/export JSON, FTS5, wizard, thème, 4 decks démo. | Schéma v1, ~25 commandes, 6 routes. |
| **Session 2** | Génération IA (texte+PDF), TTS OpenAI (8 voix, cache), import APKG, image-occlusion, reset_card. | Modules `ai`/`tts`/`apkg`/`media`, v2 (template occlusion). |
| **Session 3** | Sync cloud Supabase (scaffolding, dormante). | Module `sync`, v3 (`remote_id` + `sync_state`). |
| **Session 4** | FSRS Optimizer (calibration 21 params), CI GitHub Actions, updater dormant, LICENSE MIT. | `fsrs/optimize.rs`, plugin updater. |
| **Vague 1** | Gamification éthique : streaks + freezes, 10 succès, maîtrise WaniKani. | v4 (`user_stats`+`achievements`), route `/achievements`. |
| **Vague 2** | Cognitif : type-the-answer, confidence rating (CBM), pré-questionnement IA. | v5 (`reviews.confidence`), module `cognitive`. |
| **Vague 3** | Neuro modes opt-in : mood/sleep check-in, pauses mouvement, cyclic sighing. | v6 (`wellness_logs`), module `wellness`. |
| **Vague 4** | Schedulers pluggables par deck (FSRS-6 / SM-2 / Leitner). | v7 (`scheduler_kind`), module `scheduler/` (ADR-6). |
| **Vague 5** | Élaboration IA (Why/Example) + Review entrelacée. | `get_interleaved_due_cards`, route `/review-interleaved`. |
| **Vague 7** | Sketch-before-flip + Delayed-JOL & Calibration γ. | v8 (`review_sketches`), v9 (`jol_predictions`), modules `sketches`/`metacognition`. |
| **Vague 8** | Deck Podcast (2 voix, 3 formats) + Whisper Mode. | modules `podcast`/`whisper`. |
| **Vague 9** | Memory Palace 3D Builder (R3F, 3 templates). | v10 (`palaces`+`palace_loci`), module `palaces`, routes `/palaces*` (ADR-8). |
| **Vague 10** | Mode Langue : template Phrase (bidirectional), frequency band, langue du deck. | v11 (templates + `frequency_band` + `language_mode`). |
| **Vague 11** | Subtitle Import (.srt/.vtt) + Knowledge Graph (tags). | module `subtitles`, `get_tag_graph`, route `/graph`. |
| **Vague 12** | Pretest Mode, Self-explanation, Focus Guard (webcam local). | toggles `AppSettings`, WebGazer (ADR-7). |
| **Vague 13** | Multi-Agent Card Pipeline (Generator→Critic) + Mnemonic Helper. | `critique_generated_cards`, `generate_card_mnemonic` (ADR-9). |
| **Vague 14** | Templates disciplinaires : Illness Script (médecine) + Refutation Card (sciences). | v12 (templates `illness_script`/`refutation`), onglets Médecine/Sciences. |
| **Vague 15** | Mode Maths (Faded Worked Example) + Mastery Gating (Bloom) + confiance rétrospective. | v13 (template `worked_example` + `prerequisite_deck_id` + `confidence_post`). |
| **Vague 16** | Modes créatifs : Musique (métronome + ear training) + Arts (gesture timer). | routes `/music`, `/gesture` (100 % Web Audio + Canvas, pas de backend). |
| **Vague 17** | Shadowing + Reading Import LingQ-style + citations PDF (tag source). | v14 (`word_status`), module `reading`, routes `/shadowing`, `/reading`. |
| **Vague 18** | Tuteur IA local (Ollama) + Chronotype (rMEQ) + son d'ambiance. | `generate_cards_local` (ADR-12), réglages Neuro modes. |
| **Vague 20** | Schedulers HLR + MEMORIZE + maîtrise concepts BKT. | v15 (`scheduler_kind` élargi), `hlr`/`memorize` (ADR-10), module `mastery` (ADR-11). |
| **Vague 21** | Implementation Intentions (planificateur) + Major System/PAO. | v16 (`study_plans`), module `plans`, routes `/planner`, `/mnemonics`. |
| **Vague 22** | Piper TTS local + image mnémotechnique (DALL-E) + calibration rétrospective (γ_post). | `synthesize_audio_local` (ADR-12), `generate_card_mnemonic_image`. |
| **Vague 23** | Temporal Mastery Graph + mode review mains-libres. | `get_mastery_timeline`, orchestration TTS+Whisper (ADR-13). |

> Les Vagues sont numérotées de façon non strictement séquentielle (pas de Vague 6 ni 19 publiques ; la v7 du **schéma DB** correspond à la **Vague 4**, etc.). La table *Migrations* ci-dessus donne la correspondance exacte version-de-schéma ↔ vague.


> **Note v0.11** : ce document décrit l'architecture historique. La restructuration v0.11 (« Recentrage ») a supprimé les modules sync/wellness/palaces/JOL et le multi-scheduler — voir `AUDIT_V0.11.md` et le CHANGELOG pour l'état courant.
