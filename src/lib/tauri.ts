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
    }) =>
      invoke<Deck>("create_deck", {
        name: data.name,
        description: data.description ?? null,
        color: data.color,
        desiredRetention: data.desiredRetention ?? null,
      }),
    update: (id: number, patch: DeckPatch) => invoke<Deck>("update_deck", { id, patch }),
    delete: (id: number) => invoke<void>("delete_deck", { id }),
    stats: (id: number) => invoke<DeckStats>("get_deck_stats", { id }),
    count: () => invoke<number>("count_decks"),
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
    previewNextStates: (cardId: number) => invoke<NextStates>("preview_next_states", { cardId }),
    submit: (data: { cardId: number; rating: Rating; reviewTimeMs: number }) =>
      invoke<ReviewResult>("submit_review", {
        cardId: data.cardId,
        rating: data.rating,
        reviewTimeMs: data.reviewTimeMs,
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
};
