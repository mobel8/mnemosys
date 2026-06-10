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
export type NoteTemplate =
  | "basic"
  | "basic_reverse"
  | "cloze"
  | "occlusion"
  | "sentence"
  | "bidirectional"
  | "illness_script"
  | "refutation"
  | "worked_example";

/**
 * Vague 10 — Zipf-bucket label for language-learning notes (Pareto 80/20
 * vocabulary coverage). `null`/omitted means the note is un-tagged.
 */
export type FrequencyBand = "top_100" | "top_1k" | "top_5k" | "top_10k" | "beyond";

/**
 * Scheduling algorithm a deck uses (Vague 4). Stored on the deck row so
 * cards inside one deck always agree on which algorithm to run, while
 * different decks can mix and match.
 *
 * - `fsrs6`    — default, adaptive 21-parameter engine (predicts retention).
 * - `sm2`      — classic Anki-style SuperMemo-2 (deterministic, EF-based).
 * - `leitner`  — 5-box system (forgiving, very simple).
 * - `hlr`      — Half-Life Regression (Settles & Meeder 2016, Duolingo).
 * - `memorize` — optimal-control spacing (Tabibian et al. 2019).
 */
export type SchedulerKind = "fsrs6" | "sm2" | "leitner" | "hlr" | "memorize";

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

/**
 * Vague 14 — `fields` payload for `template === "illness_script"` notes
 * (médecine, Charlin 2007). `condition` is the card prompt; the four clinical
 * sections are individually optional but at least one must be filled.
 */
export interface IllnessScriptFields {
  condition: string;
  epidemiology?: string;
  pathophysiology?: string;
  clinical?: string;
  management?: string;
}

/**
 * Vague 14 — `fields` payload for `template === "refutation"` notes (sciences,
 * Tippett 2010 meta). `misconception` and `correct` are both required;
 * `explanation` is an optional deeper rationale shown under the correction.
 */
export interface RefutationFields {
  misconception: string;
  correct: string;
  explanation?: string;
}

/**
 * Vague 15 — `fields` payload for `template === "worked_example"` notes
 * (maths, Sweller/Renkl/Atkinson 2003 faded worked example). `problem` is the
 * recto prompt; `steps` are revealed progressively on the verso before the
 * final `answer`. `problem` and `answer` are required; `steps` must hold at
 * least one non-empty entry.
 */
export interface WorkedExampleFields {
  problem: string;
  steps: string[];
  answer: string;
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
  /**
   * Vague 10 — ISO 639-1 language code (`"en"`, `"ja"`, …) flagging this as
   * a language-learning deck, or `null` for an ordinary deck. When set, the
   * deck detail page surfaces the frequency-coverage card.
   */
  language_mode: string | null;
  /**
   * Vague 15 — Bloom mastery gating. Id of the deck that must be mastered
   * before this one unlocks, or `null` for an ungated deck.
   */
  prerequisite_deck_id: number | null;
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
  /** Set the deck language (`null` clears it, `undefined` leaves it). */
  language_mode?: string | null;
  /** Set the mastery-gate prerequisite (`null` clears it, `undefined` leaves it). */
  prerequisite_deck_id?: number | null;
}

/**
 * Vague 15 — Bloom mastery-learning gate status for one deck (mirrors the
 * Rust `MasteryStatus`). `unlocked` answers "may the learner study this deck?"
 * (no prerequisite, or prerequisite mastered). `mastered` is the ≥90 % /
 * ≥20-review criterion applied to THIS deck.
 */
export interface MasteryStatus {
  mastered: boolean;
  /** Retention rate of this deck over the last 30 days, in [0, 1]. */
  retention_rate: number;
  /** Reviews counted toward `retention_rate` (last 30 days). */
  review_count: number;
  /** The prerequisite deck id, if any. */
  prerequisite_id: number | null;
  /** Whether the prerequisite (if any) is itself mastered; `true` when none. */
  prerequisite_mastered: boolean;
  /** Whether the learner may study this deck now. */
  unlocked: boolean;
}

/**
 * Vague 10 — vocabulary-coverage breakdown for a language deck. The six
 * fields sum to the deck's total note count; render as a stacked bar.
 */
export interface FrequencyCoverage {
  top_100: number;
  top_1k: number;
  top_5k: number;
  top_10k: number;
  beyond: number;
  untagged: number;
}

export interface DeckStats {
  total_cards: number;
  new_cards: number;
  learning_cards: number;
  review_cards: number;
  /** P080 — suspended cards, the missing summand of `total_cards`. */
  suspended_cards: number;
  due_today: number;
  /** P057 — cards the Deck Podcast can voice (every non-occlusion template). */
  podcastable_cards: number;
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
  /**
   * Vague 7 — primary key of the freshly-inserted `reviews` row. Used by
   * the sketch-before-flip feature to attach the captured PNG to this
   * exact review via `save_sketch(reviewId, …)`.
   */
  review_id: number;
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

/**
 * P081 — a deck plus its dashboard aggregates in one payload. The Rust side
 * `#[serde(flatten)]`s the `Deck` fields, so this extends `Deck` rather than
 * nesting it.
 */
export interface DeckWithStats extends Deck {
  stats: DeckStats;
  mastery: DeckMastery;
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
  // --- Vague 22 (local offline TTS via Piper) ---
  /** When on, the 🔊 button synthesises speech locally via Piper (offline, free, private). */
  piper_enabled: boolean;
  /** Path to the Piper binary. Empty falls back to the bare name `"piper"` ($PATH lookup). */
  piper_binary_path: string;
  /** Path to the `.onnx` Piper voice model. Empty -> local synthesis errors with a download hint. */
  piper_model_path: string;
  /** Anthropic API key for AI card generation. `null` falls back to env var. */
  anthropic_api_key: string | null;
  // --- Active recall options (the methods that earned their keep) ---
  /** Type-the-answer mode: input + Levenshtein scoring before flipping. */
  type_the_answer_enabled: boolean;
  /** Confidence rating (CBM): capture 1..5 confidence BEFORE the flip. */
  confidence_rating_enabled: boolean;
  // --- Labs ---
  /** Drawing effect: sketch the answer before flipping (Labs). */
  sketch_before_flip_enabled: boolean;
  /** Voice answer via Whisper inside type-the-answer (needs OpenAI key). */
  voice_answer_enabled: boolean;
  /** Hands-free (audio + voice) review mode (Labs). */
  hands_free_enabled: boolean;
  /** Context ambient sound during reviews. */
  ambient_sound: "none" | "white" | "pink" | "brown" | "rain";
  // --- Local AI (Ollama) ---
  /** Local AI Tutor: generate cards via a local Ollama LLM instead of Claude. */
  ollama_enabled: boolean;
  /** Ollama daemon base URL. `null` falls back to `http://localhost:11434`. */
  ollama_url: string | null;
  /** Ollama model slug (e.g. `"llama3.2"`). `null` falls back to `llama3.2`. */
  ollama_model: string | null;
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

/**
 * Vague 13 — one critic verdict for a generated card (Generator → Critic
 * multi-agent pipeline). Mirrors the Rust `CardCritique`. `card_index` is the
 * 0-based position in the batch the critic was given; `score` is the
 * reviewer's overall quality estimate in `[0, 1]`. `suggested_fix` is a
 * rewritten card the UI can apply with one click, present only when the
 * reviewer judged the original below the quality bar.
 */
export interface CardCritique {
  card_index: number;
  score: number;
  issues: string[];
  suggested_fix: GeneratedCard | null;
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

// --- Vague 11: subtitle import (.srt / .vtt sentence-mining) ---------------

/** How a subtitle file is turned into notes. */
export type SubtitleMode = "sentence" | "cloze";

/** Outcome tally for one subtitle import. */
export interface SubtitleImportResult {
  /** Cues the parser produced after stripping formatting + merging lines. */
  cues_parsed: number;
  /** Notes actually inserted. */
  notes_created: number;
  /** Cues dropped as empty / music / un-clozable. */
  skipped_empty: number;
}

// --- Vague 11: knowledge graph (tag co-occurrence) -------------------------

/** A distinct tag node: the tag string and how many notes carry it. */
export interface TagNode {
  tag: string;
  count: number;
}

/** An undirected edge: two tags co-occurring on `weight` notes. */
export interface TagEdge {
  source: string;
  target: string;
  weight: number;
}

/** Tag co-occurrence graph for the Knowledge Graph view. */
export interface TagGraph {
  nodes: TagNode[];
  edges: TagEdge[];
}

// --- Vague 7: drawing effect + delayed JOL --------------------------------

/**
 * One sketch captured at review time (drawing effect, Wammes 2016).
 * `sketch_data` is a `data:image/png;base64,…` URL so the frontend can pipe
 * it straight into `<img src>` or back onto a Canvas without conversion.
 */
export interface Sketch {
  review_id: number;
  card_id: number;
  sketch_data: string;
  created_at: number;
}

/** One bar of the calibration histogram. Always 10 buckets, even when empty. */
export interface CalibrationBucket {
  /** Lower edge of the confidence band: `0.0`, `0.1`, …, `0.9`. */
  band: number;
  predicted: number;
  actual: number;
  count: number;
}

/**
 * Aggregated calibration stats computed from CBM confidence ratings
 * (`reviews.confidence` vs rating >= 3). v0.11 — the dead-born JOL pipeline
 * was removed; confidence captured before the flip is now the single
 * metacognitive source.
 */
export interface CalibrationStats {
  /** Goodman-Kruskal γ in `[-1, 1]`. */
  gamma: number;
  /** `mean(predicted) - mean(actual)`. Positive = overconfidence. */
  bias: number;
  /** Always 10 buckets, indexed by `band`. */
  buckets: CalibrationBucket[];
  total_resolved: number;
}

/**
 * One concept's mastery estimate from Bayesian Knowledge Tracing (Vague 20,
 * Corbett & Anderson 1995). Concepts map to note tags; `mastery` is the
 * posterior P(mastered) in `[0, 1]` after replaying every review of the
 * cards carrying that tag.
 */
export interface ConceptMastery {
  tag: string;
  /** Posterior probability of mastery in `[0, 1]`. */
  mastery: number;
  /** Number of reviews that fed the estimate. */
  reviews: number;
}

/**
 * One tag's retention trajectory across the timeline's weeks (Vague 23).
 * `points[i]` aligns with `MasteryTimeline.weeks[i]`; `null` means the tag
 * had no reviews that week (the chart draws a gap, not a misleading 0%).
 */
export interface TagSeries {
  tag: string;
  points: (number | null)[];
}

/**
 * Retention-over-time for the busiest tags, bucketed by ISO week (Vague 23 —
 * Temporal Mastery Graph). Complements `ConceptMastery` (a single snapshot)
 * by exposing the *trajectory* of each concept's recall.
 */
export interface MasteryTimeline {
  /** ISO-week labels oldest → newest, e.g. `"2026-W18"`. */
  weeks: string[];
  /** One trajectory per surfaced tag (top 8 by review volume). */
  series: TagSeries[];
}

// --- Vague 8: Deck Podcast + Whisper Mode Review -------------------------

/** Tone preset used by the podcast scriptwriter. */
export type PodcastFormat = "deep_dive" | "brief" | "critique";

/**
 * Result of `generate_deck_podcast`. `cached === true` means the MP3 was
 * served from the on-disk cache and no API calls were made — in that case
 * `line_count` and `duration_estimate_seconds` may be 0 (the backend
 * doesn't re-derive them from the file).
 */
export interface PodcastResult {
  /** Absolute path on disk. Pass through `convertFileSrc()` for playback. */
  path: string;
  duration_estimate_seconds: number;
  line_count: number;
  cached: boolean;
  size_bytes: number;
}

/** One row in `list_deck_podcasts`. */
export interface PodcastFile {
  path: string;
  /** Unix seconds. */
  generated_at: number;
  size_bytes: number;
}

// --- Session 4: FSRS optimizer -------------------------------------------

/**
 * Outcome of one successful `optimize_fsrs_params` run. Mirrors the Rust
 * `OptimizeResult` struct (see `commands/fsrs_optimizer.rs`).
 *
 * - `params`           : freshly-trained 21-element FSRS-6 vector, now active.
 * - `reviews_used`     : count of `reviews` rows fed into the optimiser.
 * - `previous_params`  : the vector that was active **before** this run; kept
 *   here so a future « undo » affordance can diff the two without an extra
 *   round-trip.
 */
export interface OptimizeResult {
  params: number[];
  reviews_used: number;
  previous_params: number[];
}

// --- Vague 17: Reading Import (LingQ-style word tracking) ------------------

/** Learner classification of one word while reading an imported text. */
export type WordStatusKind = "new" | "learning" | "known";

/**
 * One persisted `(word, language)` classification. `word` and `language` are
 * the normalised (trimmed, lower-cased) forms the backend stored. Mirrors the
 * Rust `WordStatus` struct.
 */
export interface WordStatus {
  word: string;
  language: string;
  status: WordStatusKind;
  /** unix seconds. */
  updated_at: number;
}

// --- Vague 21: Implementation Intentions (study planner) ------------------

/**
 * Kind of cue an implementation intention fires on (Gollwitzer 1999).
 * - `time`        — a `HH:MM` clock cue (drives local notifications).
 * - `place`       — a location label (« bureau », « bibliothèque »).
 * - `after_habit` — piggy-backs on an existing routine (« après le café »).
 */
export type PlanTriggerType = "time" | "place" | "after_habit";

/**
 * One « si [trigger] alors [action] » study plan. Mirrors the Rust
 * `StudyPlan` struct. `days` is a JSON-encoded array of ISO weekday ints
 * (`"[1,3,5]"`, `1`=Mon … `7`=Sun); `"[]"` means every day. `deck_id` is a
 * soft reference (no FK), so it may point at a since-deleted deck.
 */
export interface StudyPlan {
  id: number;
  trigger_type: PlanTriggerType;
  trigger_value: string;
  action: string;
  deck_id: number | null;
  /** JSON array string of ISO weekdays; `"[]"` = every day. */
  days: string;
  enabled: boolean;
  /** unix seconds. */
  created_at: number;
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
      /** Vague 10 — ISO 639-1 code flagging a language deck; omit for none. */
      languageMode?: string | null;
      /** Vague 15 — id of the deck that gates this one; omit for ungated. */
      prerequisiteDeckId?: number | null;
    }) =>
      invoke<Deck>("create_deck", {
        name: data.name,
        description: data.description ?? null,
        color: data.color,
        desiredRetention: data.desiredRetention ?? null,
        languageMode: data.languageMode ?? null,
        prerequisiteDeckId: data.prerequisiteDeckId ?? null,
      }),
    update: (id: number, patch: DeckPatch) => invoke<Deck>("update_deck", { id, patch }),
    delete: (id: number) => invoke<void>("delete_deck", { id }),
    stats: (id: number) => invoke<DeckStats>("get_deck_stats", { id }),
    withStats: () => invoke<DeckWithStats[]>("get_decks_with_stats"),
    /** WaniKani-style mastery buckets (apprentice / guru / master / …). */
    mastery: (id: number) => invoke<DeckMastery>("get_deck_mastery", { id }),
    /** Vague 15 — Bloom mastery-gate status (is this deck mastered / unlocked?). */
    masteryStatus: (deckId: number) => invoke<MasteryStatus>("get_deck_mastery_status", { deckId }),
  },
  cards: {
    listInDeck: (deckId: number, limit: number, offset: number) =>
      invoke<CardWithNote[]>("list_cards_in_deck", {
        deckId,
        limit,
        offset,
      }),
    // P017: resolve a single card + its note in one JOIN (used by PalaceReview).
    getCardWithNote: (cardId: number) => invoke<CardWithNote>("get_card_with_note", { cardId }),
    searchNotes: (query: string, limit: number) => invoke<Note[]>("search_notes", { query, limit }),
    createNote: (data: {
      deckId: number;
      template: NoteTemplate;
      fields: Record<string, unknown>;
      tags?: string[];
      /** Vague 10 — optional Zipf frequency bucket; omit to leave un-tagged. */
      frequencyBand?: FrequencyBand | null;
    }) =>
      invoke<Note>("create_note", {
        deckId: data.deckId,
        template: data.template,
        fields: data.fields,
        tags: data.tags ?? [],
        frequencyBand: data.frequencyBand ?? null,
      }),
    /** Vague 10 — vocabulary-coverage breakdown for a language deck. */
    frequencyCoverage: (deckId: number) =>
      invoke<FrequencyCoverage>("get_frequency_coverage", { deckId }),
    /**
     * Vague 11 — tag co-occurrence graph for the Knowledge Graph view.
     * `deckId = null` spans every deck; a number scopes to one deck.
     */
    tagGraph: (deckId: number | null) => invoke<TagGraph>("get_tag_graph", { deckId }),
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
    dueCards: (deckId: number | null, limit: number, newLimit?: number) =>
      invoke<CardWithNote[]>("get_due_cards", { deckId, limit, newLimit }),
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
     * confidence captured BEFORE the flip (CBM). `null`/`undefined`
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
    /** BKT concept-mastery breakdown by tag (Vague 20). */
    conceptMastery: () => invoke<ConceptMastery[]>("get_concept_mastery"),
    /** Retention trajectory by ISO week, grouped by tag (Vague 23). */
    masteryTimeline: (weeks: number) => invoke<MasteryTimeline>("get_mastery_timeline", { weeks }),
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
    /**
     * Vague 11 — import a `.srt` / `.vtt` subtitle file as sentence-mining
     * notes into `deckId`. `mode` is `"sentence"` (Basic front/back, back
     * pre-filled with a translation placeholder) or `"cloze"` (longest word
     * blanked). Music/empty cues are filtered and reported in `skipped_empty`.
     */
    importSubtitles: (path: string, deckId: number, mode: SubtitleMode) =>
      invoke<SubtitleImportResult>("import_subtitles", { path, deckId, mode }),
  },
  ai: {
    /** Generate up to `maxCards` cards from a raw text blob. `language` is a hint. */
    generateCardsText: (text: string, maxCards: number, language: string) =>
      invoke<GeneratedCard[]>("generate_cards_text", { text, maxCards, language }),
    /** Generate cards from a PDF on disk. */
    generateCardsPdf: (pdfPath: string, maxCards: number, language: string) =>
      invoke<GeneratedCard[]>("generate_cards_pdf", { pdfPath, maxCards, language }),
    /**
     * Vague 18 — generate cards from text via a **local** Ollama LLM (privacy
     * + zero API cost). Reads the daemon URL/model from settings. Throws with
     * an « Ollama unreachable » message when the daemon isn't running.
     */
    generateCardsLocal: (text: string, maxCards: number, language: string) =>
      invoke<GeneratedCard[]>("generate_cards_local", { text, maxCards, language }),
    /**
     * Vague 5 — produce a `{ why, example }` pedagogical elaboration for a
     * single card. `cardText` is the prompt+answer concatenation the
     * caller already has handy (basic: « front / back »; cloze: full text).
     */
    generateCardElaboration: (cardText: string, language: string) =>
      invoke<CardElaboration>("generate_card_elaboration", { cardText, language }),
    /**
     * Vague 13 — run a "critic" pass over a batch of generated cards. Returns
     * one verdict per card (same order). Stateless; the caller reviews scores
     * and optionally applies `suggested_fix` before persisting.
     */
    critiqueCards: (cards: GeneratedCard[]) =>
      invoke<CardCritique[]>("critique_generated_cards", { cards }),
    /**
     * Vague 13 — generate a vivid mnemonic aid for a card the learner keeps
     * forgetting. Loads the card's front/back server-side; `language` is a
     * locale hint. Returns 2-3 sentences of plain prose.
     */
    generateMnemonic: (cardId: number, language: string) =>
      invoke<string>("generate_card_mnemonic", { cardId, language }),
    /**
     * Vague 22 — generate (or reuse) a DALL·E mnemonic image for a card the
     * learner keeps forgetting. Builds an absurd-scene prompt server-side from
     * the card's front/back and writes a PNG under the app data dir. Returns
     * the absolute path; pass through `convertFileSrc()` before `<img src>`.
     * Throws with a "configure your OpenAI key" message when no key is set.
     */
    generateMnemonicImage: (cardId: number) =>
      invoke<string>("generate_card_mnemonic_image", { cardId }),
  },
  tts: {
    /** Synthesise speech. Hits cache first; otherwise calls OpenAI. */
    synthesize: (text: string, voice: TTSVoice, speed?: number) =>
      invoke<TTSResult>("synthesize_audio", { text, voice, speed: speed ?? null }),
    /**
     * Vague 22 — synthesise speech **locally** via the Piper CLI (offline,
     * free, private). Hits the same on-disk cache first (as a WAV). The voice
     * comes from the configured Piper model, so no `voice` argument is taken.
     * Throws "Piper unavailable: …" when the binary or model is missing.
     */
    synthesizeLocal: (text: string, speed?: number) =>
      invoke<TTSResult>("synthesize_audio_local", { text, speed: speed ?? null }),
    /** Wipe every cached audio file (`*.mp3` + `*.wav`) from the TTS cache directory. */
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
  sketches: {
    /**
     * Persist a sketch captured BEFORE the learner flipped the card. The
     * `reviewId` must point at a freshly-inserted `reviews` row; pair this
     * with the `review_id` field returned by `submit_review`.
     */
    save: (reviewId: number, cardId: number, sketchData: string) =>
      invoke<Sketch>("save_sketch", {
        reviewId,
        cardId,
        sketchData,
      }),
    /** Last `limit` sketches for a card, newest first. Caps at 50 server-side. */
    listForCard: (cardId: number, limit: number) =>
      invoke<Sketch[]>("get_card_sketches", { cardId, limit }),
  },
  metacognition: {
    /** Calibration stats from CBM confidence vs outcomes. Optionally per-deck. */
    getCalibrationStats: (deckId?: number | null) =>
      invoke<CalibrationStats>("get_calibration_stats", { deckId: deckId ?? null }),
  },
  podcast: {
    /**
     * Generate (or cache-hit) a 2-voice podcast for a deck. Round-trips
     * Claude (script) + OpenAI TTS (audio). Returns the absolute MP3 path.
     */
    generate: (data: {
      deckId: number;
      format: PodcastFormat;
      hostVoice: TTSVoice;
      expertVoice: TTSVoice;
      language?: string;
    }) =>
      invoke<PodcastResult>("generate_deck_podcast", {
        deckId: data.deckId,
        format: data.format,
        hostVoice: data.hostVoice,
        expertVoice: data.expertVoice,
        language: data.language ?? null,
      }),
    /** List existing MP3s previously generated for this deck. Newest first. */
    list: (deckId: number) => invoke<PodcastFile[]>("list_deck_podcasts", { deckId }),
    /** Delete one generated MP3. Path MUST live inside the podcast cache. */
    delete: (path: string) => invoke<void>("delete_podcast", { path }),
  },
  whisper: {
    /**
     * Transcribe a base64-encoded voice recording via OpenAI Whisper. The
     * caller is responsible for stripping any `data:...;base64,` prefix
     * before invoking. `mimeType` typically matches the MediaRecorder output
     * (`audio/webm` on Chrome / Tauri's webview).
     */
    transcribe: (audioBase64: string, mimeType: string, language?: string) =>
      invoke<string>("transcribe_voice_answer", {
        audioBase64,
        mimeType,
        language: language ?? null,
      }),
  },
  reading: {
    /**
     * Vague 17 — fetch the stored status of each word in `words` for
     * `language`. Words with no row are simply absent from the result; the
     * caller treats those as `new`. Casing/whitespace are normalised server
     * side, so pass words however the tokenizer produced them.
     */
    getWordStatuses: (words: string[], language: string) =>
      invoke<WordStatus[]>("get_word_statuses", { words, language }),
    /** Upsert one word's status (`new` / `learning` / `known`). Idempotent. */
    setWordStatus: (word: string, status: WordStatusKind, language: string) =>
      invoke<WordStatus>("set_word_status", { word, status, language }),
    /**
     * Create one Basic card (front = word, back = « (à traduire) ») per
     * distinct word in `words`, inside `deckId`. Returns the count created.
     */
    createCardsFromWords: (deckId: number, words: string[], translations: string[] = []) =>
      invoke<number>("create_cards_from_words", { deckId, words, translations }),
  },
  plans: {
    /** Every study plan, newest first. */
    list: () => invoke<StudyPlan[]>("list_study_plans"),
    /**
     * Create a « si [trigger] alors [action] » plan. `days` is a JSON array
     * string (`"[1,3,5]"`, `"[]"` = every day); `enabled` defaults to `true`
     * server-side when omitted.
     */
    create: (data: {
      triggerType: PlanTriggerType;
      triggerValue: string;
      action: string;
      deckId?: number | null;
      days?: string;
      enabled?: boolean;
    }) =>
      invoke<StudyPlan>("create_study_plan", {
        triggerType: data.triggerType,
        triggerValue: data.triggerValue,
        action: data.action,
        deckId: data.deckId ?? null,
        days: data.days ?? "[]",
        enabled: data.enabled ?? null,
      }),
    /** Overwrite the mutable fields of an existing plan. */
    update: (data: {
      id: number;
      triggerType: PlanTriggerType;
      triggerValue: string;
      action: string;
      deckId?: number | null;
      days?: string;
      enabled: boolean;
    }) =>
      invoke<StudyPlan>("update_study_plan", {
        id: data.id,
        triggerType: data.triggerType,
        triggerValue: data.triggerValue,
        action: data.action,
        deckId: data.deckId ?? null,
        days: data.days ?? "[]",
        enabled: data.enabled,
      }),
    /** Flip a plan's `enabled` flag. */
    toggle: (id: number, enabled: boolean) =>
      invoke<StudyPlan>("toggle_study_plan", { id, enabled }),
    /** Delete a plan by id. */
    delete: (id: number) => invoke<void>("delete_study_plan", { id }),
  },
  fsrsOptimizer: {
    /**
     * Cheap `COUNT(*)` on the `reviews` table. The Settings UI calls this on
     * mount to decide whether to surface the « Calibrer FSRS » button or the
     * « keep revising » hint.
     */
    getTotalReviewsCount: () => invoke<number>("get_total_reviews_count"),
    /**
     * Re-fit the 21-element FSRS parameter vector on this user's review log.
     * `minReviews` is the gate: the backend errors with `Validation` when the
     * row count is below it. Omit / pass `null` to use the built-in default
     * (1000). On success the new params are persisted and the live scheduler
     * is rebuilt so the next review picks them up immediately.
     */
    optimize: (minReviews?: number | null) =>
      invoke<OptimizeResult>("optimize_fsrs_params", {
        minReviews: minReviews ?? null,
      }),
  },
};
