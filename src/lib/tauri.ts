/**
 * Typed wrappers around the Tauri `invoke()` bridge.
 *
 * Every command exposed by the Rust backend (`src-tauri/src/commands/`) has
 * a matching entry under `api.<feature>.<command>` here. Types mirror the
 * Rust structs and use **snake_case** field names to match serde's default
 * serialization on the Rust side. Method arguments **must** use camelCase
 * keys though — Tauri's invoke layer transparently maps `desiredRetention`
 * (TS) → `desired_retention` (Rust).
 *
 * Treat this module as the single source of truth for the IPC surface:
 *   - Adding a backend command? Add a wrapper here and use it from React.
 *   - Renaming a Rust field? Update the matching TS type below.
 */

import { invoke } from "@tauri-apps/api/core";

// ---------------------------------------------------------------------------
// Domain types — keep field names in **snake_case** to match Rust serde.
// ---------------------------------------------------------------------------

export type CardState = "new" | "learning" | "review" | "relearning";
export type NoteTemplate = "basic" | "basic_reverse" | "cloze" | "occlusion";

/**
 * Scheduling algorithm a deck uses (Vague 4). Stored on the deck row so
 * cards inside one deck always agree on which algorithm to run, while
 * different decks can mix and match.
 *
 * - `fsrs6`   — default, adaptive 21-parameter engine (predicts retention).
 * - `sm2`     — classic Anki-style SuperMemo-2 (deterministic, EF-based).
 * - `leitner` — 5-box system (forgiving, very simple).
 */
export type SchedulerKind = "fsrs6" | "sm2" | "leitner";

/** One rectangular mask in an image-occlusion note. Coordinates are in
 *  source-image pixels (matching `natural_width` / `natural_height` in the
 *  same fields blob). `label` is the answer the learner must recall. */
export interface OcclusionMask {
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
}

/** `fields` payload for `template === "occlusion"` notes. */
export interface OcclusionFields {
  image_path: string;
  natural_width: number;
  natural_height: number;
  masks: OcclusionMask[];
}
/** Rating sent to `submit_review`: 1 = Again, 2 = Hard, 3 = Good, 4 = Easy. */
export type Rating = 1 | 2 | 3 | 4;

export interface Deck {
  id: number;
  name: string;
  description: string | null;
  color: string;
  desired_retention: number;
  /** Scheduling algorithm used by this deck — see {@link SchedulerKind}. */
  scheduler_kind: SchedulerKind;
  created_at: number;
  updated_at: number;
}

/** Patch payload for `update_deck`. Omit a field to leave it untouched. */
export interface DeckPatch {
  name?: string;
  /** Double-wrapped: `null` clears the description, `undefined` leaves it. */
  description?: string | null;
  color?: string;
  desired_retention?: number;
  /** Switch the scheduling algorithm. Existing cards are not reset. */
  scheduler_kind?: SchedulerKind;
}

export interface DeckStats {
  total_cards: number;
  new_cards: number;
  learning_cards: number;
  review_cards: number;
  due_today: number;
}

export interface Note {
  id: number;
  deck_id: number;
  template: NoteTemplate;
  fields: Record<string, unknown>;
  tags: string[];
  created_at: number;
  updated_at: number;
}

export interface Card {
  id: number;
  note_id: number;
  deck_id: number;
  card_ord: number;
  state: CardState;
  stability: number | null;
  difficulty: number | null;
  last_review: number | null;
  next_review: number | null;
  elapsed_days: number;
  scheduled_days: number;
  reps: number;
  lapses: number;
  suspended: boolean;
  created_at: number;
  updated_at: number;
}

export interface CardWithNote {
  card: Card;
  note: Note;
}

export interface MemoryState {
  stability: number;
  difficulty: number;
}

export interface NextState {
  memory: MemoryState;
  interval_days: number;
}

export interface NextStates {
  again: NextState;
  hard: NextState;
  good: NextState;
  easy: NextState;
}

export interface ReviewResult {
  card: Card;
  scheduled_days: number;
  /** Refreshed gamification snapshot, `null` if the side-effect failed. */
  user_stats: UserStats | null;
  /** Codes of achievements unlocked **by this review** (for celebratory toasts). */
  newly_unlocked: string[];
}

// --- Vague 1: gamification ------------------------------------------------

/**
 * White Hat gamification snapshot. Tracks streaks, monthly freeze inventory,
 * and lifetime review counters. Mirrors the Rust singleton `user_stats`
 * (id = 1).
 */
export interface UserStats {
  streak_current: number;
  streak_best: number;
  /** ISO `YYYY-MM-DD` of the most recent review. `null` before the first one. */
  last_review_date: string | null;
  /** Freezes still available this calendar month (default budget = 2). */
  freeze_remaining: number;
  /** ISO `YYYY-MM` of the month the freeze counter belongs to. */
  freeze_month: string | null;
  total_reviews: number;
  total_correct: number;
}

export interface Achievement {
  id: number;
  code: string;
  /** unix-seconds timestamp. */
  unlocked_at: number;
}

/**
 * WaniKani-style mastery distribution for a single deck. Sums to the deck's
 * total non-suspended card count. Buckets are derived from FSRS stability:
 * <7 / 7-30 / 30-90 / 90-180 / >=180 days.
 */
export interface DeckMastery {
  apprentice: number;
  guru: number;
  master: number;
  enlightened: number;
  burned: number;
}

export interface DayCount {
  date: string;
  count: number;
}

export interface DayRetention {
  date: string;
  total: number;
  correct: number;
  rate: number;
}

export interface TodayStats {
  reviews_done_today: number;
  due_now: number;
  new_cards_today: number;
  retention_today: number;
}

export interface AppSettings {
  theme: "light" | "dark" | "system";
  desired_retention: number;
  daily_new_limit: number;
  daily_review_limit: number;
  show_next_interval: boolean;
  // --- Session 2 additions ---
  /** OpenAI API key for TTS. `null` falls back to `OPENAI_API_KEY` env var. */
  openai_api_key: string | null;
  /** Default TTS voice slug. `null` falls back to `"nova"` in the UI. */
  tts_voice: string | null;
  /** Default TTS playback rate (0.25..=4.0). `null` falls back to `1.0`. */
  tts_speed: number | null;
  /** Anthropic API key for AI card generation. `null` falls back to env var. */
  anthropic_api_key: string | null;
  // --- Session 3 (cloud sync) ---
  /** Base URL of the user's Supabase project (e.g. `https://abc.supabase.co`). */
  supabase_url: string | null;
  /** Project anon (public) key, required for every PostgREST + Auth call. */
  supabase_anon_key: string | null;
  // --- Vague 2 (cognitive features) ---
  /** Type-the-answer mode: input + Levenshtein scoring before flipping. */
  type_the_answer_enabled: boolean;
  /** Confidence rating: capture 1..5 metacognitive confidence before FSRS rating. */
  confidence_rating_enabled: boolean;
  /** Pre-questioning IA: curiosity-priming questions before each new session block. */
  pre_questioning_enabled: boolean;
  // --- Vague 3 (neuro modes, opt-in) ---
  /** Master switch — when `false` every sub-toggle below is inert. */
  neuro_modes_enabled: boolean;
  /** Show Mood/Sleep check-in modal at session start (once per day). */
  mood_checkin_enabled: boolean;
  /** Cadence in minutes (10..60) for the movement break reminder. */
  movement_break_minutes: number;
  /** Offer the cyclic-sighing primer (Spiegel 2023) when stress flagged. */
  cyclic_sighing_enabled: boolean;
}

// --- Vague 3: wellness ----------------------------------------------------

/**
 * One wellness check-in (Vague 3 — opt-in neuro modes). Every nullable
 * field reflects « learner skipped that question ». Booleans always have a
 * concrete value.
 */
export interface WellnessLog {
  id: number;
  /** ISO `YYYY-MM-DD` of the check-in. */
  date: string;
  /** Self-reported mood `[1..5]`. */
  mood: number | null;
  /** Hours of sleep the previous night. */
  sleep_hours: number | null;
  /** Self-reported stress `[1..5]`. */
  stress_level: number | null;
  hydrated: boolean;
  caffeine_taken: boolean;
  /** Unix seconds. */
  created_at: number;
}

/**
 * Per-import summary returned by `import_json`. Mirrors `ImportResult`
 * (snake_case) on the Rust side.
 */
export interface ImportResult {
  decks_imported: number;
  notes_imported: number;
  cards_created: number;
  /** Names of decks skipped because the same name already exists locally. */
  skipped_decks: string[];
}

// --- Session 2: AI card generation ---------------------------------------

export type AICardTemplate = "basic" | "cloze";

/** One card returned by the Claude generator. Shape of `fields` depends on `template`. */
export interface GeneratedCard {
  template: AICardTemplate;
  /** For `basic`: `{ front, back }`. For `cloze`: `{ text }` with `{{c1::…}}`. */
  fields: Record<string, unknown>;
  tags: string[];
}

/**
 * Vague 5 — elaboration enrichment for a single card. Mirrors the Rust
 * `CardElaborationDTO`. Both fields may be empty strings if Claude failed
 * to produce a useful payload; callers should treat empty values as
 * « nothing to display » rather than erroring.
 */
export interface CardElaboration {
  /** One-sentence elaborative-interrogation rationale. */
  why: string;
  /** 1-2 short concrete examples, joined by `\n` when multiple. */
  example: string;
}

// --- Session 2: TTS ------------------------------------------------------

export type TTSVoice = "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer" | "coral" | "sage";

export interface TTSResult {
  /** Absolute path on disk. Pass through `convertFileSrc()` before `<audio src>`. */
  path: string;
  /** `true` if served from local cache (no API call). */
  cached: boolean;
  size_bytes: number;
}

// --- Session 2: APKG import ----------------------------------------------

export interface ConversionStats {
  decks_imported: number;
  notes_imported: number;
  /** Notes dropped (unsupported model, parent deck skipped, missing required field, …). */
  notes_skipped: number;
  /** Anki "orphan" notes (no `cards` row pointing at them). */
  cards_skipped_no_anki_card: number;
}

export interface ConversionResult {
  stats: ConversionStats;
  /** Names of Anki decks that were skipped because Mnemosys already had that name. */
  skipped_decks: string[];
}

// --- Session 3: cloud sync -----------------------------------------------

/**
 * Persisted JWT bundle returned by `sync_login`. Mirrors the Rust struct of
 * the same name. Tokens live in `sync_session.json`.
 */
export interface SyncSession {
  user_id: string;
  email: string;
  access_token: string;
  refresh_token: string;
  /** Absolute unix-seconds deadline of `access_token`. */
  expires_at: number;
}

/** Server-side output of `sync_login` — wraps the session so future fields can be added without breaking. */
export interface SyncLoginOutput {
  session: SyncSession;
}

/** Lightweight snapshot driving the Settings UI. */
export interface SyncStatus {
  /** `true` when both `supabase_url` and `supabase_anon_key` are set. */
  configured: boolean;
  /** `true` when a non-expired session lives in the local store. */
  logged_in: boolean;
  email: string | null;
  last_sync_at: number | null;
}

/** Summary returned by `sync_now`. */
export interface SyncReport {
  decks_pushed: number;
  decks_pulled: number;
  notes_pushed: number;
  notes_pulled: number;
  cards_pushed: number;
  cards_pulled: number;
  reviews_pushed: number;
  reviews_pulled: number;
  /** unix-seconds timestamp written back to `sync_state.last_sync_at`. */
  finished_at: number;
}

// ---------------------------------------------------------------------------
// API surface
// ---------------------------------------------------------------------------

export const api = {
  decks: {
    list: () => invoke<Deck[]>("list_decks"),
    get: (id: number) => invoke<Deck>("get_deck", { id }),
    create: (data: {
      name: string;
      description?: string | null;
      color: string;
      desiredRetention?: number;
      /** Scheduling algorithm — defaults server-side to FSRS-6 when omitted. */
      schedulerKind?: SchedulerKind;
    }) =>
      invoke<Deck>("create_deck", {
        name: data.name,
        description: data.description ?? null,
        color: data.color,
        desiredRetention: data.desiredRetention ?? null,
        schedulerKind: data.schedulerKind ?? null,
      }),
    update: (id: number, patch: DeckPatch) => invoke<Deck>("update_deck", { id, patch }),
    delete: (id: number) => invoke<void>("delete_deck", { id }),
    stats: (id: number) => invoke<DeckStats>("get_deck_stats", { id }),
    count: () => invoke<number>("count_decks"),
    /** WaniKani-style mastery buckets (apprentice / guru / master / …). */
    mastery: (id: number) => invoke<DeckMastery>("get_deck_mastery", { id }),
  },
  cards: {
    listInDeck: (deckId: number, limit: number, offset: number) =>
      invoke<CardWithNote[]>("list_cards_in_deck", {
        deckId,
        limit,
        offset,
      }),
    searchNotes: (query: string, limit: number) => invoke<Note[]>("search_notes", { query, limit }),
    createNote: (data: {
      deckId: number;
      template: NoteTemplate;
      fields: Record<string, unknown>;
      tags?: string[];
    }) =>
      invoke<Note>("create_note", {
        deckId: data.deckId,
        template: data.template,
        fields: data.fields,
        tags: data.tags ?? [],
      }),
    updateNote: (id: number, fields: Record<string, unknown>) =>
      invoke<Note>("update_note", { id, fields }),
    deleteNote: (id: number) => invoke<void>("delete_note", { id }),
    suspendCard: (id: number, suspended: boolean) =>
      invoke<void>("suspend_card", { id, suspended }),
    /**
     * Reset a card to its pristine `new` state. Clears every FSRS scheduling
     * field but **does not** delete the `reviews` history.
     */
    resetCard: (id: number) => invoke<Card>("reset_card", { id }),
  },
  review: {
    dueCards: (deckId: number | null, limit: number) =>
      invoke<CardWithNote[]>("get_due_cards", { deckId, limit }),
    /**
     * Vague 5 — multi-deck interleaved due queue. Returns up to `limit`
     * cards drawn from every deck listed in `deckIds`, shuffled so the
     * learner mixes contexts (Rohrer & Taylor 2015).
     */
    dueCardsInterleaved: (deckIds: number[], limit: number) =>
      invoke<CardWithNote[]>("get_interleaved_due_cards", { deckIds, limit }),
    previewNextStates: (cardId: number) => invoke<NextStates>("preview_next_states", { cardId }),
    /**
     * Submit a graded card. `confidence` is the optional 1..5 metacognitive
     * confidence captured BEFORE the FSRS rating (CBM). `null`/`undefined`
     * means « confidence rating toggle was off this session ».
     */
    submit: (data: {
      cardId: number;
      rating: Rating;
      reviewTimeMs: number;
      confidence?: number | null;
    }) =>
      invoke<ReviewResult>("submit_review", {
        cardId: data.cardId,
        rating: data.rating,
        reviewTimeMs: data.reviewTimeMs,
        confidence: data.confidence ?? null,
      }),
  },
  stats: {
    today: () => invoke<TodayStats>("get_today_stats"),
    reviewsByDay: (days: number) => invoke<DayCount[]>("get_reviews_by_day", { days }),
    retentionByDay: (days: number) => invoke<DayRetention[]>("get_retention_by_day", { days }),
  },
  demo: {
    load: () => invoke<number>("load_demo_decks"),
  },
  settings: {
    get: () => invoke<AppSettings>("get_settings"),
    save: (settings: AppSettings) => invoke<void>("save_settings", { settings }),
  },
  io: {
    /**
     * Export the listed decks (and all their notes) as a single JSON file
     * at `path`. Returns the number of notes written so the caller can show
     * a toast without re-reading the file.
     */
    exportJson: (deckIds: number[], path: string) =>
      invoke<number>("export_json", { deckIds, path }),
    /**
     * Read a Mnemosys JSON export and ingest it into the live database.
     * Decks whose name already exists are skipped wholesale.
     */
    importJson: (path: string) => invoke<ImportResult>("import_json", { path }),
    /**
     * Import an Anki `.apkg` file. Anki decks whose name already exists in
     * Mnemosys are skipped wholesale (their names are reported back).
     * Anki review history is dropped — imported cards start in `new`.
     */
    importApkg: (path: string) => invoke<ConversionResult>("import_apkg", { path }),
  },
  ai: {
    /** Generate up to `maxCards` cards from a raw text blob. `language` is a hint. */
    generateCardsText: (text: string, maxCards: number, language: string) =>
      invoke<GeneratedCard[]>("generate_cards_text", { text, maxCards, language }),
    /** Generate cards from a PDF on disk. */
    generateCardsPdf: (pdfPath: string, maxCards: number, language: string) =>
      invoke<GeneratedCard[]>("generate_cards_pdf", { pdfPath, maxCards, language }),
    /**
     * Vague 5 — produce a `{ why, example }` pedagogical elaboration for a
     * single card. `cardText` is the prompt+answer concatenation the
     * caller already has handy (basic: « front / back »; cloze: full text).
     */
    generateCardElaboration: (cardText: string, language: string) =>
      invoke<CardElaboration>("generate_card_elaboration", { cardText, language }),
  },
  tts: {
    /** Synthesise speech. Hits cache first; otherwise calls OpenAI. */
    synthesize: (text: string, voice: TTSVoice, speed?: number) =>
      invoke<TTSResult>("synthesize_audio", { text, voice, speed: speed ?? null }),
    /** Wipe every cached `*.mp3` from the TTS cache directory. */
    clearCache: () => invoke<void>("clear_tts_cache"),
    /** Total bytes occupied by the TTS cache directory. */
    cacheSize: () => invoke<number>("get_tts_cache_size"),
  },
  media: {
    /**
     * Copy an image into the per-app occlusion-media folder so it can be
     * served back via `convertFileSrc()`. Idempotent: identical bytes share
     * the same destination filename (content-addressed prefix).
     */
    copyImageToAppData: (sourcePath: string) =>
      invoke<string>("copy_image_to_app_data", { sourcePath }),
  },
  gamification: {
    /** Read the singleton stats row. */
    getUserStats: () => invoke<UserStats>("get_user_stats"),
    /** Burn one streak-saving freeze. Errors when none remain. */
    consumeFreeze: () => invoke<UserStats>("use_streak_freeze"),
    /** All unlocked badges, newest first. */
    listAchievements: () => invoke<Achievement[]>("list_unlocked_achievements"),
  },
  cognitive: {
    /**
     * Generate `count` curiosity-priming pre-questions for a deck. The deck
     * must contain at least one non-occlusion note (else the backend returns
     * a `Validation` error). Requires an Anthropic API key configured in
     * settings or via `ANTHROPIC_API_KEY`.
     */
    generatePreQuestions: (deckId: number, count: number, language: string) =>
      invoke<string[]>("generate_pre_questions", { deckId, count, language }),
  },
  wellness: {
    /**
     * Persist a fresh wellness check-in. Every value is optional (`null` =
     * « learner skipped that field »); the booleans default to `false`.
     */
    submit: (data: {
      mood: number | null;
      sleepHours: number | null;
      stressLevel: number | null;
      hydrated: boolean;
      caffeineTaken: boolean;
    }) =>
      invoke<WellnessLog>("submit_wellness_log", {
        mood: data.mood,
        sleepHours: data.sleepHours,
        stressLevel: data.stressLevel,
        hydrated: data.hydrated,
        caffeineTaken: data.caffeineTaken,
      }),
    /** Today's most recent wellness log, or `null` when none exists. */
    today: () => invoke<WellnessLog | null>("get_today_wellness"),
    /** Last `days` wellness logs, newest first. */
    recent: (days: number) => invoke<WellnessLog[]>("get_recent_wellness", { days }),
  },
  sync: {
    /**
     * Trade an email + password for a Supabase JWT and persist it in
     * `sync_session.json`. Returns the freshly-minted session.
     *
     * Errors:
     *   - `Validation`: sync not configured (URL/anon key missing) or
     *     Supabase returned a non-2xx response (wrong password, etc.).
     */
    login: (email: string, password: string) =>
      invoke<SyncLoginOutput>("sync_login", { email, password }),
    /** Wipe the local session and best-effort revoke server-side. */
    logout: () => invoke<void>("sync_logout"),
    /** Lightweight status snapshot. Cheap; the UI calls it on every settings open. */
    status: () => invoke<SyncStatus>("sync_status"),
    /**
     * Run one full sync cycle (push → pull → resolve). Returns row counters
     * so the caller can show a useful toast. Requires `logged_in === true`.
     */
    now: () => invoke<SyncReport>("sync_now"),
  },
};
