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
  // --- Vague 7 (Tier S — sketch + delayed JOL) ---
  /** Drawing effect: sketch the answer before flipping (Wammes 2016, +30-50%). */
  sketch_before_flip_enabled: boolean;
  /** Delayed JOL: prompt the learner ~N min after a review to predict recall. */
  delayed_jol_enabled: boolean;
  /** Delay (minutes, clamped 5..120) between a review and the delayed prompt. */
  jol_delay_minutes: number;
  // --- Vague 8 (Tier A — audio-first differentiation) ---
  /**
   * Whisper Mode Review: when on, basic / basic_reverse cards expose a Mic
   * button. The learner speaks the answer; OpenAI Whisper transcribes; the
   * same Levenshtein scorer used by `type_the_answer` grades the result.
   * Requires an OpenAI API key. Defaults to false.
   */
  voice_answer_enabled: boolean;
  // --- Vague 12 (cognitive features, opt-in) ---
  /** Pretest mode: guess the answer of a brand-new card before the flip (pretesting effect — Pan 2023). */
  pretest_mode_enabled: boolean;
  /** Self-explanation: on ~1/5 reviews, prompt "why is this the answer?" after the flip (Chi 1989, g≈0.55). */
  self_explanation_enabled: boolean;
  /** Focus Guard: opt-in local webcam mind-wandering detection during a session (Hutt 2024). */
  focus_guard_enabled: boolean;
  // --- Vague 18 (local AI + advanced neuro, opt-in) ---
  /** Local AI Tutor: generate cards via a local Ollama LLM instead of Claude. */
  ollama_enabled: boolean;
  /** Ollama daemon base URL. `null` falls back to `http://localhost:11434`. */
  ollama_url: string | null;
  /** Ollama model slug (e.g. `"llama3.2"`). `null` falls back to `llama3.2`. */
  ollama_model: string | null;
  /** Chronotype from the MEQ quiz: `"morning" | "intermediate" | "evening"`, or `null` if uncalibrated. */
  chronotype: string | null;
  /** Context ambient sound during reviews (Godden & Baddeley 1975). */
  ambient_sound: "none" | "white" | "pink" | "brown" | "rain";
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

/**
 * One Judgment of Learning prediction. `actual_correct` and `resolved_at`
 * stay `null` until the next review on the same card flips them.
 */
export interface JolPrediction {
  id: number;
  card_id: number;
  predicted_at: number;
  /** Predicted recall probability in `[0.0, 1.0]`. */
  predicted_prob: number;
  prediction_horizon_days: number;
  actual_correct: boolean | null;
  resolved_at: number | null;
}

/** One bar of the calibration histogram. Always 10 buckets, even when empty. */
export interface CalibrationBucket {
  /** Lower edge of the confidence band: `0.0`, `0.1`, …, `0.9`. */
  band: number;
  predicted: number;
  actual: number;
  count: number;
}

/** Aggregated calibration stats over resolved predictions. */
export interface CalibrationStats {
  /** Goodman-Kruskal γ in `[-1, 1]`. */
  gamma: number;
  /** `mean(predicted) - mean(actual)`. Positive = overconfidence. */
  bias: number;
  /** Always 10 buckets, indexed by `band`. */
  buckets: CalibrationBucket[];
  total_resolved: number;
}

/** Pending JOL paired with the card it references, returned by `get_pending_jols`. */
export interface PendingJol {
  prediction: JolPrediction;
  card: CardWithNote;
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

// --- Vague 9: Memory Palace 3D Builder ------------------------------------

/** Pre-fabricated 3D scene templates the builder can instantiate. */
export type PalaceTemplate = "house" | "street" | "castle" | "custom";

/** One palace row. */
export interface Palace {
  id: number;
  name: string;
  description: string | null;
  template: PalaceTemplate;
  created_at: number;
  updated_at: number;
}

/** One locus (card pinned at (x, y, z) inside a palace). */
export interface PalaceLocus {
  id: number;
  palace_id: number;
  card_id: number;
  x: number;
  y: number;
  z: number;
  /** 1-based traversal order (lowest = visited first in review walk-through). */
  ordinal: number;
  label: string | null;
  created_at: number;
}

/** `get_palace` payload — the palace + its loci sorted by ordinal. */
export interface PalaceWithLoci extends Palace {
  loci: PalaceLocus[];
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
      /** Scheduling algorithm — defaults server-side to FSRS-6 when omitted. */
      schedulerKind?: SchedulerKind;
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
        schedulerKind: data.schedulerKind ?? null,
        languageMode: data.languageMode ?? null,
        prerequisiteDeckId: data.prerequisiteDeckId ?? null,
      }),
    update: (id: number, patch: DeckPatch) => invoke<Deck>("update_deck", { id, patch }),
    delete: (id: number) => invoke<void>("delete_deck", { id }),
    stats: (id: number) => invoke<DeckStats>("get_deck_stats", { id }),
    count: () => invoke<number>("count_decks"),
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
      /**
       * Vague 15 — optional 1..5 *retrospective* confidence captured AFTER the
       * answer is revealed (Bang & Fleming 2018). `null`/`undefined` when the
       * two-step toggle is off this session.
       */
      confidencePost?: number | null;
    }) =>
      invoke<ReviewResult>("submit_review", {
        cardId: data.cardId,
        rating: data.rating,
        reviewTimeMs: data.reviewTimeMs,
        confidence: data.confidence ?? null,
        confidencePost: data.confidencePost ?? null,
      }),
  },
  stats: {
    today: () => invoke<TodayStats>("get_today_stats"),
    reviewsByDay: (days: number) => invoke<DayCount[]>("get_reviews_by_day", { days }),
    retentionByDay: (days: number) => invoke<DayRetention[]>("get_retention_by_day", { days }),
    /** BKT concept-mastery breakdown by tag (Vague 20). */
    conceptMastery: () => invoke<ConceptMastery[]>("get_concept_mastery"),
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
    /**
     * Record a learner self-prediction. `horizonDays` defaults to 7 on the
     * server when omitted. `predictedProb` must be in `[0.0, 1.0]`.
     */
    recordJol: (cardId: number, predictedProb: number, horizonDays?: number) =>
      invoke<JolPrediction>("record_jol", {
        cardId,
        predictedProb,
        horizonDays: horizonDays ?? null,
      }),
    /** Predictions older than `minAgeMinutes` that haven't been resolved yet. */
    getPendingJols: (minAgeMinutes: number, limit: number) =>
      invoke<PendingJol[]>("get_pending_jols", {
        minAgeMinutes,
        limit,
      }),
    /** Calibration stats over resolved predictions. Optionally per-deck. */
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
  palaces: {
    /** All palaces, alphabetical by name. */
    list: () => invoke<Palace[]>("list_palaces"),
    /** Fetch one palace + every locus pinned inside, ordered by `ordinal`. */
    get: (id: number) => invoke<PalaceWithLoci>("get_palace", { id }),
    /** Create a new palace. `name` must be unique. */
    create: (data: { name: string; description?: string | null; template: PalaceTemplate }) =>
      invoke<Palace>("create_palace", {
        name: data.name,
        description: data.description ?? null,
        template: data.template,
      }),
    /**
     * Partially update a palace. Pass `description: null` to clear it, omit
     * the field to leave it untouched. Tauri sends `Option<Option<String>>`
     * to the backend so the two cases stay distinguishable.
     */
    update: (
      id: number,
      patch: {
        name?: string;
        description?: string | null;
        template?: PalaceTemplate;
      },
    ) =>
      invoke<Palace>("update_palace", {
        id,
        name: patch.name ?? null,
        description: patch.description === undefined ? null : [patch.description],
        template: patch.template ?? null,
      }),
    /** Delete a palace. Loci cascade. */
    delete: (id: number) => invoke<void>("delete_palace", { id }),
    /** Pin a card at a locus. The traversal `ordinal` is auto-assigned to `max + 1`. */
    addLocus: (data: {
      palaceId: number;
      cardId: number;
      x: number;
      y: number;
      z: number;
      label?: string | null;
    }) =>
      invoke<PalaceLocus>("add_palace_locus", {
        palaceId: data.palaceId,
        cardId: data.cardId,
        x: data.x,
        y: data.y,
        z: data.z,
        label: data.label ?? null,
      }),
    /** Remove a single locus by id. */
    removeLocus: (locusId: number) => invoke<void>("remove_palace_locus", { locusId }),
    /**
     * Rewrite ordinals so loci visit in the caller-provided sequence.
     * `newOrder` must contain every existing locus id of the palace.
     */
    reorderLoci: (palaceId: number, newOrder: number[]) =>
      invoke<void>("reorder_palace_loci", { palaceId, newOrder }),
    /** Move a locus to a new (x, y, z). Ordinal is preserved. */
    moveLocus: (data: { locusId: number; x: number; y: number; z: number }) =>
      invoke<void>("move_palace_locus", {
        locusId: data.locusId,
        x: data.x,
        y: data.y,
        z: data.z,
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
    createCardsFromWords: (deckId: number, words: string[]) =>
      invoke<number>("create_cards_from_words", { deckId, words }),
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
