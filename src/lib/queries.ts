/**
 * TanStack Query hooks wrapping the Tauri command surface.
 *
 * Naming convention:
 *   - `useFooQuery` / `useFoo` for read paths (cached, automatic refetch).
 *   - `useCreateFoo` / `useUpdateFoo` / etc. for mutations, with sensible
 *     `invalidateQueries` calls so dependent screens refresh.
 *
 * The query keys are exported via `queryKeys.*` so components can target
 * specific invalidations from anywhere.
 */

import {
  type UseMutationOptions,
  type UseQueryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  type Achievement,
  type AppSettings,
  api,
  type CalibrationStats,
  type Card,
  type CardCritique,
  type CardElaboration,
  type CardWithNote,
  type ConceptMastery,
  type ConversionResult,
  type DayCount,
  type DayRetention,
  type Deck,
  type DeckMastery,
  type DeckPatch,
  type DeckStats,
  type DeckWithStats,
  type FrequencyBand,
  type FrequencyCoverage,
  type GeneratedCard,
  type ImportResult,
  type MasteryStatus,
  type MasteryTimeline,
  type NextStates,
  type Note,
  type NoteTemplate,
  type OptimizeResult,
  type PlanTriggerType,
  type PodcastFile,
  type PodcastFormat,
  type PodcastResult,
  type Rating,
  type ReviewResult,
  type Sketch,
  type StudyPlan,
  type SubtitleImportResult,
  type SubtitleMode,
  type TagGraph,
  type TodayStats,
  type TTSResult,
  type TTSVoice,
  type UserStats,
  type WordStatus,
  type WordStatusKind,
} from "@/lib/tauri";

export const queryKeys = {
  decks: ["decks"] as const,
  deck: (id: number) => ["deck", id] as const,
  deckStats: (id: number) => ["deck-stats", id] as const,
  deckMastery: (id: number) => ["deck-mastery", id] as const,
  deckMasteryStatus: (id: number) => ["deck-mastery-status", id] as const,
  cardsInDeck: (deckId: number, limit: number, offset: number) =>
    ["cards-in-deck", deckId, limit, offset] as const,
  frequencyCoverage: (deckId: number) => ["frequency-coverage", deckId] as const,
  dueCards: (deckId: number | null, limit: number) => ["due-cards", deckId, limit] as const,
  interleavedDueCards: (deckIds: number[], limit: number) =>
    ["interleaved-due-cards", [...deckIds].sort((a, b) => a - b), limit] as const,
  nextStates: (cardId: number) => ["next-states", cardId] as const,
  searchNotes: (query: string, limit: number) => ["search-notes", query, limit] as const,
  todayStats: ["today-stats"] as const,
  reviewsByDay: (days: number) => ["reviews-by-day", days] as const,
  retentionByDay: (days: number) => ["retention-by-day", days] as const,
  conceptMastery: ["concept-mastery"] as const,
  masteryTimeline: (weeks: number) => ["mastery-timeline", weeks] as const,
  settings: ["settings"] as const,
  ttsCacheSize: ["tts-cache-size"] as const,
  userStats: ["user-stats"] as const,
  achievements: ["achievements"] as const,
  // Sketch history (Labs)
  cardSketches: (cardId: number, limit: number) => ["card-sketches", cardId, limit] as const,
  calibrationStats: (deckId: number | null) => ["calibration-stats", deckId] as const,
  // Vague 8 — Deck Podcast
  deckPodcasts: (deckId: number) => ["deck-podcasts", deckId] as const,
  // Session 4 — FSRS optimizer
  totalReviewsCount: ["total-reviews-count"] as const,
  // Vague 11 — Knowledge Graph (tag co-occurrence)
  tagGraph: (deckId: number | null) => ["tag-graph", deckId] as const,
  // Vague 17 — Reading Import (word status lookup, keyed by sorted words)
  wordStatuses: (words: string[], language: string) =>
    ["word-statuses", language, [...words].sort()] as const,
  // Vague 21 — Implementation Intentions (study planner)
  studyPlans: ["study-plans"] as const,
};

// ---------------------------------------------------------------------------
// Read queries
// ---------------------------------------------------------------------------

export function useDecks(opts?: Partial<UseQueryOptions<Deck[]>>) {
  return useQuery<Deck[]>({
    queryKey: queryKeys.decks,
    queryFn: () => api.decks.list(),
    ...opts,
  });
}

/**
 * P081 — every deck plus its stats + mastery in ONE IPC call, for the dashboard
 * grid (replaces `useDecks` + per-card `useDeckStats`/`useDeckMastery`, i.e.
 * 1 + 2N..3N calls → 1). The key is prefixed by `queryKeys.decks`, so every
 * mutation that already invalidates `["decks"]` (create/update/delete deck,
 * review submit) refreshes this batch too.
 */
export function useDecksWithStats(opts?: Partial<UseQueryOptions<DeckWithStats[]>>) {
  return useQuery<DeckWithStats[]>({
    queryKey: [...queryKeys.decks, "with-stats"] as const,
    queryFn: () => api.decks.withStats(),
    ...opts,
  });
}

export function useDeck(id: number, opts?: Partial<UseQueryOptions<Deck>>) {
  return useQuery<Deck>({
    queryKey: queryKeys.deck(id),
    queryFn: () => api.decks.get(id),
    enabled: Number.isFinite(id),
    ...opts,
  });
}

export function useDeckStats(id: number, opts?: Partial<UseQueryOptions<DeckStats>>) {
  return useQuery<DeckStats>({
    queryKey: queryKeys.deckStats(id),
    queryFn: () => api.decks.stats(id),
    enabled: Number.isFinite(id),
    ...opts,
  });
}

export function useDeckMastery(id: number, opts?: Partial<UseQueryOptions<DeckMastery>>) {
  return useQuery<DeckMastery>({
    queryKey: queryKeys.deckMastery(id),
    queryFn: () => api.decks.mastery(id),
    enabled: Number.isFinite(id),
    ...opts,
  });
}

/**
 * Vague 15 — Bloom mastery-gate status for a deck (is it mastered, and is it
 * unlocked given its prerequisite?). Drives the lock badge on the deck card.
 */
export function useDeckMasteryStatus(id: number, opts?: Partial<UseQueryOptions<MasteryStatus>>) {
  return useQuery<MasteryStatus>({
    queryKey: queryKeys.deckMasteryStatus(id),
    queryFn: () => api.decks.masteryStatus(id),
    enabled: Number.isFinite(id),
    ...opts,
  });
}

/** Vague 10 — vocabulary-coverage breakdown for a language deck. */
export function useFrequencyCoverage(
  deckId: number,
  opts?: Partial<UseQueryOptions<FrequencyCoverage>>,
) {
  return useQuery<FrequencyCoverage>({
    queryKey: queryKeys.frequencyCoverage(deckId),
    queryFn: () => api.cards.frequencyCoverage(deckId),
    enabled: Number.isFinite(deckId),
    ...opts,
  });
}

/**
 * Vague 11 — tag co-occurrence graph for the Knowledge Graph view.
 * `deckId = null` spans every deck.
 */
export function useTagGraph(deckId: number | null, opts?: Partial<UseQueryOptions<TagGraph>>) {
  return useQuery<TagGraph>({
    queryKey: queryKeys.tagGraph(deckId),
    queryFn: () => api.cards.tagGraph(deckId),
    ...opts,
  });
}

export function useCardsInDeck(
  deckId: number,
  limit = 50,
  offset = 0,
  opts?: Partial<UseQueryOptions<CardWithNote[]>>,
) {
  return useQuery<CardWithNote[]>({
    queryKey: queryKeys.cardsInDeck(deckId, limit, offset),
    queryFn: () => api.cards.listInDeck(deckId, limit, offset),
    enabled: Number.isFinite(deckId),
    ...opts,
  });
}

/** P017: fetch a single card + its note in one JOIN (PalaceReview per-locus). */
export function useCardWithNote(cardId: number, opts?: Partial<UseQueryOptions<CardWithNote>>) {
  return useQuery<CardWithNote>({
    queryKey: ["card", cardId],
    queryFn: () => api.cards.getCardWithNote(cardId),
    enabled: Number.isFinite(cardId) && cardId > 0,
    ...opts,
  });
}

export function useDueCards(
  deckId: number | null,
  limit = 100,
  // P069 — optional new-cards/day cap. Part of the query key so flipping the
  // setting doesn't serve a stale queue from cache.
  newLimit?: number,
  opts?: Partial<UseQueryOptions<CardWithNote[]>>,
) {
  return useQuery<CardWithNote[]>({
    queryKey: [...queryKeys.dueCards(deckId, limit), newLimit ?? null],
    queryFn: () => api.review.dueCards(deckId, limit, newLimit),
    ...opts,
  });
}

/**
 * Vague 5 — multi-deck interleaved due queue. Disabled until `deckIds` is
 * non-empty so toggling decks on/off in the picker doesn't fire a backend
 * call with an invalid empty list (the command rejects it).
 *
 * Cache key normalises `deckIds` order so checking decks in a different
 * sequence still hits the same cache entry.
 */
export function useInterleavedDueCards(
  deckIds: number[],
  limit = 20,
  opts?: Partial<UseQueryOptions<CardWithNote[]>>,
) {
  return useQuery<CardWithNote[]>({
    queryKey: queryKeys.interleavedDueCards(deckIds, limit),
    queryFn: () => api.review.dueCardsInterleaved(deckIds, limit),
    enabled: deckIds.length > 0,
    // The interleaved queue is consumed by the session, not the dashboard —
    // we want a fresh shuffled snapshot every time the user clicks « start ».
    staleTime: 0,
    refetchOnWindowFocus: false,
    ...opts,
  });
}

export function useNextStates(cardId: number, opts?: Partial<UseQueryOptions<NextStates>>) {
  return useQuery<NextStates>({
    queryKey: queryKeys.nextStates(cardId),
    queryFn: () => api.review.previewNextStates(cardId),
    enabled: Number.isFinite(cardId),
    ...opts,
  });
}

export function useSearchNotes(query: string, limit = 25, opts?: Partial<UseQueryOptions<Note[]>>) {
  return useQuery<Note[]>({
    queryKey: queryKeys.searchNotes(query, limit),
    queryFn: () => api.cards.searchNotes(query, limit),
    enabled: query.trim().length > 0,
    ...opts,
  });
}

export function useTodayStats(opts?: Partial<UseQueryOptions<TodayStats>>) {
  return useQuery<TodayStats>({
    queryKey: queryKeys.todayStats,
    queryFn: () => api.stats.today(),
    ...opts,
  });
}

export function useReviewsByDay(days = 30, opts?: Partial<UseQueryOptions<DayCount[]>>) {
  return useQuery<DayCount[]>({
    queryKey: queryKeys.reviewsByDay(days),
    queryFn: () => api.stats.reviewsByDay(days),
    ...opts,
  });
}

export function useRetentionByDay(days = 30, opts?: Partial<UseQueryOptions<DayRetention[]>>) {
  return useQuery<DayRetention[]>({
    queryKey: queryKeys.retentionByDay(days),
    queryFn: () => api.stats.retentionByDay(days),
    ...opts,
  });
}

/** BKT concept-mastery breakdown by tag (Vague 20). */
export function useConceptMastery(opts?: Partial<UseQueryOptions<ConceptMastery[]>>) {
  return useQuery<ConceptMastery[]>({
    queryKey: queryKeys.conceptMastery,
    queryFn: () => api.stats.conceptMastery(),
    ...opts,
  });
}

/** Retention trajectory by ISO week, grouped by tag (Vague 23). */
export function useMasteryTimeline(weeks = 12, opts?: Partial<UseQueryOptions<MasteryTimeline>>) {
  return useQuery<MasteryTimeline>({
    queryKey: queryKeys.masteryTimeline(weeks),
    queryFn: () => api.stats.masteryTimeline(weeks),
    ...opts,
  });
}

export function useSettingsQuery(opts?: Partial<UseQueryOptions<AppSettings>>) {
  return useQuery<AppSettings>({
    queryKey: queryKeys.settings,
    queryFn: () => api.settings.get(),
    ...opts,
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function useCreateDeck(
  opts?: UseMutationOptions<
    Deck,
    Error,
    {
      name: string;
      description?: string | null;
      color: string;
      desiredRetention?: number;
      /** Vague 10 — optional ISO 639-1 code flagging a language deck. */
      languageMode?: string | null;
      /** Vague 15 — optional Bloom mastery-gate prerequisite deck id. */
      prerequisiteDeckId?: number | null;
    }
  >,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input) => api.decks.create(input),
    ...opts,
    onSuccess: (data, variables, onMutateResult, context) => {
      qc.invalidateQueries({ queryKey: queryKeys.decks });
      opts?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

export function useUpdateDeck(
  opts?: UseMutationOptions<Deck, Error, { id: number; patch: DeckPatch }>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }) => api.decks.update(id, patch),
    ...opts,
    onSuccess: (data, variables, onMutateResult, context) => {
      qc.invalidateQueries({ queryKey: queryKeys.decks });
      qc.invalidateQueries({ queryKey: queryKeys.deck(variables.id) });
      qc.invalidateQueries({ queryKey: queryKeys.deckStats(variables.id) });
      // A prerequisite change ripples to every deck's gate status, so
      // invalidate the whole mastery-status family rather than one id.
      qc.invalidateQueries({ queryKey: ["deck-mastery-status"] });
      opts?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

export function useDeleteDeck(opts?: UseMutationOptions<void, Error, number>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.decks.delete(id),
    ...opts,
    onSuccess: (data, variables, onMutateResult, context) => {
      qc.invalidateQueries({ queryKey: queryKeys.decks });
      opts?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

export function useCreateNote(
  opts?: UseMutationOptions<
    Note,
    Error,
    {
      deckId: number;
      template: NoteTemplate;
      fields: Record<string, unknown>;
      tags?: string[];
      /** Vague 10 — optional Zipf frequency bucket for language notes. */
      frequencyBand?: FrequencyBand | null;
    }
  >,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input) => api.cards.createNote(input),
    ...opts,
    onSuccess: (data, variables, onMutateResult, context) => {
      qc.invalidateQueries({ queryKey: queryKeys.deckStats(variables.deckId) });
      qc.invalidateQueries({ queryKey: ["cards-in-deck", variables.deckId] });
      qc.invalidateQueries({ queryKey: queryKeys.frequencyCoverage(variables.deckId) });
      opts?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

export function useUpdateNote(
  opts?: UseMutationOptions<Note, Error, { id: number; fields: Record<string, unknown> }>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, fields }) => api.cards.updateNote(id, fields),
    ...opts,
    onSuccess: (data, variables, onMutateResult, context) => {
      qc.invalidateQueries({ queryKey: ["cards-in-deck"] });
      opts?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

export function useDeleteNote(opts?: UseMutationOptions<void, Error, number>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.cards.deleteNote(id),
    ...opts,
    onSuccess: (data, variables, onMutateResult, context) => {
      qc.invalidateQueries({ queryKey: ["cards-in-deck"] });
      qc.invalidateQueries({ queryKey: ["deck-stats"] });
      // P056 — a deleted note removes its card(s) from the due queue and
      // reshapes the deck's mastery distribution (and the Bloom gate). The
      // command returns `void` (no deck id), so invalidate the whole families.
      qc.invalidateQueries({ queryKey: ["due-cards"] });
      qc.invalidateQueries({ queryKey: ["deck-mastery"] });
      qc.invalidateQueries({ queryKey: ["deck-mastery-status"] });
      opts?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

export function useSuspendCard(
  opts?: UseMutationOptions<void, Error, { id: number; suspended: boolean }>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, suspended }) => api.cards.suspendCard(id, suspended),
    ...opts,
    onSuccess: (data, variables, onMutateResult, context) => {
      qc.invalidateQueries({ queryKey: ["cards-in-deck"] });
      qc.invalidateQueries({ queryKey: ["due-cards"] });
      qc.invalidateQueries({ queryKey: ["deck-stats"] });
      // P056 — suspending / unsuspending a card shifts the deck's mastery
      // distribution (and may flip the Bloom gate). The command returns `void`,
      // so invalidate the whole mastery families.
      qc.invalidateQueries({ queryKey: ["deck-mastery"] });
      qc.invalidateQueries({ queryKey: ["deck-mastery-status"] });
      opts?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

/** Mutation: reset a card to `new` (FSRS-wise). Reviews history is preserved. */
export function useResetCard(opts?: UseMutationOptions<Card, Error, number>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.cards.resetCard(id),
    ...opts,
    onSuccess: (data, variables, onMutateResult, context) => {
      qc.invalidateQueries({ queryKey: ["cards-in-deck"] });
      qc.invalidateQueries({ queryKey: ["due-cards"] });
      qc.invalidateQueries({ queryKey: ["deck-stats"] });
      // P056 — resetting a card to `new` drops it out of the « mastered »
      // tally, so refresh the deck's mastery (targeted via the returned card's
      // deck) plus the whole gate-status family (a reset can re-lock a deck
      // gated behind this one).
      qc.invalidateQueries({ queryKey: queryKeys.deckMastery(data.deck_id) });
      qc.invalidateQueries({ queryKey: ["deck-mastery-status"] });
      opts?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

export function useSubmitReview(
  opts?: UseMutationOptions<
    ReviewResult,
    Error,
    {
      cardId: number;
      rating: Rating;
      reviewTimeMs: number;
      /** Optional 1..5 confidence (CBM, captured before the flip). */
      confidence?: number | null;
    }
  >,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input) => api.review.submit(input),
    ...opts,
    onSuccess: (data, variables, onMutateResult, context) => {
      // Invalidation diet (audit: ~10 query families refetched PER GRADE,
      // including the parent's mounted 200-card due query). Per-card we only
      // touch the cheap daily counter; everything session-scoped (due queue,
      // charts, deck stats, mastery, gamification) is invalidated ONCE at
      // session end by `invalidateAfterSession`.
      qc.invalidateQueries({ queryKey: queryKeys.todayStats });
      // P127 — the card we just graded leaves the queue and won't be shown
      // again this session, so *drop* its interval preview rather than marking
      // it stale (which would trigger a wasted `preview_next_states` IPC +
      // FSRS tensor pass in the background). It'll be re-fetched fresh if the
      // card ever comes back due.
      qc.removeQueries({ queryKey: queryKeys.nextStates(variables.cardId) });
      opts?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

/**
 * Session-end invalidation — everything a batch of reviews could have moved.
 * Call once from the summary screen / on session exit instead of after every
 * single grade.
 */
export function invalidateAfterSession(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["due-cards"] });
  qc.invalidateQueries({ queryKey: ["interleaved-due-cards"] });
  qc.invalidateQueries({ queryKey: ["reviews-by-day"] });
  qc.invalidateQueries({ queryKey: ["retention-by-day"] });
  qc.invalidateQueries({ queryKey: ["deck-stats"] });
  qc.invalidateQueries({ queryKey: ["deck-mastery"] });
  qc.invalidateQueries({ queryKey: ["deck-mastery-status"] });
  qc.invalidateQueries({ queryKey: queryKeys.todayStats });
  qc.invalidateQueries({ queryKey: queryKeys.userStats });
  qc.invalidateQueries({ queryKey: queryKeys.achievements });
  qc.invalidateQueries({ queryKey: queryKeys.decks });
}

export function useSaveSettings(opts?: UseMutationOptions<void, Error, AppSettings>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (settings) => api.settings.save(settings),
    ...opts,
    onSuccess: (data, variables, onMutateResult, context) => {
      qc.invalidateQueries({ queryKey: queryKeys.settings });
      opts?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

export function useLoadDemo(opts?: UseMutationOptions<number, Error, void>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.demo.load(),
    ...opts,
    onSuccess: (data, variables, onMutateResult, context) => {
      qc.invalidateQueries({ queryKey: queryKeys.decks });
      opts?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

/**
 * Mutation: serialise the selected decks to a JSON file at `path`. Returns
 * the number of notes written. No cache invalidation needed — exporting
 * doesn't change DB state.
 */
export function useExportJson(
  opts?: UseMutationOptions<number, Error, { deckIds: number[]; path: string }>,
) {
  return useMutation({
    mutationFn: ({ deckIds, path }) => api.io.exportJson(deckIds, path),
    ...opts,
  });
}

/**
 * Mutation: ingest a Mnemosys JSON export. Invalidates every deck / card /
 * stats query because the import can mint arbitrary new rows across the DB.
 */
export function useImportJson(opts?: UseMutationOptions<ImportResult, Error, { path: string }>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path }) => api.io.importJson(path),
    ...opts,
    onSuccess: (data, variables, onMutateResult, context) => {
      qc.invalidateQueries({ queryKey: queryKeys.decks });
      qc.invalidateQueries({ queryKey: ["deck-stats"] });
      qc.invalidateQueries({ queryKey: ["cards-in-deck"] });
      qc.invalidateQueries({ queryKey: ["due-cards"] });
      qc.invalidateQueries({ queryKey: queryKeys.todayStats });
      qc.invalidateQueries({ queryKey: ["reviews-by-day"] });
      qc.invalidateQueries({ queryKey: ["retention-by-day"] });
      opts?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

// ---------------------------------------------------------------------------
// Session 2 — AI, TTS, APKG
// ---------------------------------------------------------------------------

/**
 * Mutation: generate flashcards from a text blob via Claude. Caller is then
 * expected to validate/edit and persist them through `useCreateNote`.
 * No cache invalidation — generation is stateless.
 */
export function useGenerateCardsFromText(
  opts?: UseMutationOptions<
    GeneratedCard[],
    Error,
    { text: string; maxCards: number; language: string }
  >,
) {
  return useMutation({
    mutationFn: ({ text, maxCards, language }) =>
      api.ai.generateCardsText(text, maxCards, language),
    ...opts,
  });
}

/**
 * Vague 18 — generate cards from text via a **local** Ollama LLM. Same shape
 * as `useGenerateCardsFromText`; the only difference is privacy + zero API
 * cost (and the « Ollama unreachable » error when the daemon isn't running).
 * Stateless — no cache invalidation.
 */
export function useGenerateCardsLocal(
  opts?: UseMutationOptions<
    GeneratedCard[],
    Error,
    { text: string; maxCards: number; language: string }
  >,
) {
  return useMutation({
    mutationFn: ({ text, maxCards, language }) =>
      api.ai.generateCardsLocal(text, maxCards, language),
    ...opts,
  });
}

/** Same as `useGenerateCardsFromText` but feeds Claude a PDF path. */
export function useGenerateCardsFromPdf(
  opts?: UseMutationOptions<
    GeneratedCard[],
    Error,
    { pdfPath: string; maxCards: number; language: string }
  >,
) {
  return useMutation({
    mutationFn: ({ pdfPath, maxCards, language }) =>
      api.ai.generateCardsPdf(pdfPath, maxCards, language),
    ...opts,
  });
}

/**
 * Vague 5 — generate `{ why, example }` elaboration for one card via Claude.
 * Stateless — no cache invalidation. The caller is responsible for merging
 * the result into the note's `fields` before persistence.
 */
export function useGenerateCardElaboration(
  opts?: UseMutationOptions<CardElaboration, Error, { cardText: string; language: string }>,
) {
  return useMutation({
    mutationFn: ({ cardText, language }) => api.ai.generateCardElaboration(cardText, language),
    ...opts,
  });
}

/**
 * Vague 13 — run the multi-agent "critic" pass over a batch of generated
 * cards. Stateless — no cache invalidation. The caller surfaces the scores
 * and applies `suggested_fix` into its local draft state.
 */
export function useCritiqueCards(
  opts?: UseMutationOptions<CardCritique[], Error, { cards: GeneratedCard[] }>,
) {
  return useMutation({
    mutationFn: ({ cards }) => api.ai.critiqueCards(cards),
    ...opts,
  });
}

/**
 * Vague 13 — generate a mnemonic aid for one (high-lapse) card. Stateless —
 * the result is shown in a toast/dialog, nothing is persisted, so no cache
 * invalidation is needed.
 */
export function useGenerateMnemonic(
  opts?: UseMutationOptions<string, Error, { cardId: number; language: string }>,
) {
  return useMutation({
    mutationFn: ({ cardId, language }) => api.ai.generateMnemonic(cardId, language),
    ...opts,
  });
}

/**
 * Mutation: synthesise (or cache-hit) speech. Result includes the on-disk
 * path; pass through `convertFileSrc()` before assigning to `<audio src>`.
 * Invalidates the cache-size query when the call was a miss.
 *
 * Vague 22 — routing: when `piper_enabled` is set in the persisted settings,
 * the call goes through the **local** Piper backend (offline WAV) instead of
 * OpenAI; the `voice` argument is ignored in that mode (Piper's voice is the
 * configured model). Settings are read from the query cache so the hook keeps
 * its existing signature and callers (e.g. `TtsButton`) need no change.
 */
export function useSynthesizeAudio(
  opts?: UseMutationOptions<TTSResult, Error, { text: string; voice: TTSVoice; speed?: number }>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ text, voice, speed }) => {
      const settings = qc.getQueryData<AppSettings>(queryKeys.settings);
      if (settings?.piper_enabled) {
        return api.tts.synthesizeLocal(text, speed);
      }
      return api.tts.synthesize(text, voice, speed);
    },
    ...opts,
    onSuccess: (data, variables, onMutateResult, context) => {
      if (!data.cached) {
        qc.invalidateQueries({ queryKey: queryKeys.ttsCacheSize });
      }
      opts?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

/**
 * Vague 22 — generate a DALL·E mnemonic image for one (high-lapse) card.
 * Stateless like `useGenerateMnemonic`: the resulting PNG path is shown in a
 * dialog (via `convertFileSrc`), nothing is persisted, so no invalidation.
 */
export function useGenerateMnemonicImage(
  opts?: UseMutationOptions<string, Error, { cardId: number }>,
) {
  return useMutation({
    mutationFn: ({ cardId }) => api.ai.generateMnemonicImage(cardId),
    ...opts,
  });
}

export function useClearTtsCache(opts?: UseMutationOptions<void, Error, void>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.tts.clearCache(),
    ...opts,
    onSuccess: (data, variables, onMutateResult, context) => {
      qc.invalidateQueries({ queryKey: queryKeys.ttsCacheSize });
      opts?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

export function useTtsCacheSize(opts?: Partial<UseQueryOptions<number>>) {
  return useQuery<number>({
    queryKey: queryKeys.ttsCacheSize,
    queryFn: () => api.tts.cacheSize(),
    ...opts,
  });
}

/**
 * Mutation: import an Anki `.apkg`. Anki decks whose name already exists in
 * Mnemosys are skipped wholesale; their names appear in `skipped_decks`.
 */
export function useImportApkg(
  opts?: UseMutationOptions<ConversionResult, Error, { path: string }>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path }) => api.io.importApkg(path),
    ...opts,
    onSuccess: (data, variables, onMutateResult, context) => {
      qc.invalidateQueries({ queryKey: queryKeys.decks });
      qc.invalidateQueries({ queryKey: ["deck-stats"] });
      qc.invalidateQueries({ queryKey: ["cards-in-deck"] });
      qc.invalidateQueries({ queryKey: ["due-cards"] });
      qc.invalidateQueries({ queryKey: queryKeys.todayStats });
      opts?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

/**
 * Vague 11 — import a `.srt` / `.vtt` subtitle file as sentence-mining notes.
 * Invalidates the target deck's card/stats queries plus every tag-graph query
 * (the new notes are tagged `subtitles`, which reshapes the graph).
 */
export function useImportSubtitles(
  opts?: UseMutationOptions<
    SubtitleImportResult,
    Error,
    { path: string; deckId: number; mode: SubtitleMode }
  >,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, deckId, mode }) => api.io.importSubtitles(path, deckId, mode),
    ...opts,
    onSuccess: (data, variables, onMutateResult, context) => {
      qc.invalidateQueries({ queryKey: queryKeys.decks });
      qc.invalidateQueries({ queryKey: queryKeys.deckStats(variables.deckId) });
      qc.invalidateQueries({ queryKey: ["cards-in-deck", variables.deckId] });
      qc.invalidateQueries({ queryKey: ["tag-graph"] });
      opts?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

// ---------------------------------------------------------------------------
// Vague 1 — White Hat gamification
// ---------------------------------------------------------------------------

/** Singleton user-wide gamification stats. Refreshed after every review. */
export function useUserStats(opts?: Partial<UseQueryOptions<UserStats>>) {
  return useQuery<UserStats>({
    queryKey: queryKeys.userStats,
    queryFn: () => api.gamification.getUserStats(),
    ...opts,
  });
}

/** All unlocked badges, newest first. */
export function useAchievements(opts?: Partial<UseQueryOptions<Achievement[]>>) {
  return useQuery<Achievement[]>({
    queryKey: queryKeys.achievements,
    queryFn: () => api.gamification.listAchievements(),
    ...opts,
  });
}

/**
 * Mutation: burn one streak-saving freeze. Errors with a `Validation` message
 * when none remain.
 */
export function useStreakFreeze(opts?: UseMutationOptions<UserStats, Error, void>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.gamification.consumeFreeze(),
    ...opts,
    onSuccess: (data, variables, onMutateResult, context) => {
      qc.invalidateQueries({ queryKey: queryKeys.userStats });
      opts?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

// ---------------------------------------------------------------------------
// Vague 7 — Tier S: sketch-before-flip + delayed JOL + calibration
// ---------------------------------------------------------------------------

/**
 * Mutation: persist a sketch captured by the canvas BEFORE the flip. The
 * `reviewId` comes from the result of `submit_review`. Invalidates the
 * matching « past sketches for card » cache so the history strip refreshes
 * the next time the user lands on that card.
 */
export function useSaveSketch(
  opts?: UseMutationOptions<
    Sketch,
    Error,
    { reviewId: number; cardId: number; sketchData: string }
  >,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ reviewId, cardId, sketchData }) =>
      api.sketches.save(reviewId, cardId, sketchData),
    ...opts,
    onSuccess: (data, variables, onMutateResult, context) => {
      qc.invalidateQueries({ queryKey: ["card-sketches", variables.cardId] });
      opts?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

/** All sketches captured for one card, newest first (capped at 50 by backend). */
export function useCardSketches(
  cardId: number,
  limit = 5,
  opts?: Partial<UseQueryOptions<Sketch[]>>,
) {
  return useQuery<Sketch[]>({
    queryKey: queryKeys.cardSketches(cardId, limit),
    queryFn: () => api.sketches.listForCard(cardId, limit),
    enabled: Number.isFinite(cardId) && cardId > 0,
    ...opts,
  });
}

/** Aggregated calibration metrics (γ, bias, 10 buckets). Optional deck filter. */
export function useCalibrationStats(
  deckId: number | null = null,
  opts?: Partial<UseQueryOptions<CalibrationStats>>,
) {
  return useQuery<CalibrationStats>({
    queryKey: queryKeys.calibrationStats(deckId),
    queryFn: () => api.metacognition.getCalibrationStats(deckId),
    ...opts,
  });
}

// ---------------------------------------------------------------------------
// Vague 8 — Deck Podcast + Whisper Mode Review
// ---------------------------------------------------------------------------

/**
 * Mutation: generate (or cache-hit) a 2-voice podcast for a deck. Invalidates
 * the deck's podcast list so the dialog refreshes immediately.
 */
export function useGenerateDeckPodcast(
  opts?: UseMutationOptions<
    PodcastResult,
    Error,
    {
      deckId: number;
      format: PodcastFormat;
      hostVoice: TTSVoice;
      expertVoice: TTSVoice;
      language?: string;
    }
  >,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input) => api.podcast.generate(input),
    ...opts,
    onSuccess: (data, variables, onMutateResult, context) => {
      qc.invalidateQueries({ queryKey: queryKeys.deckPodcasts(variables.deckId) });
      opts?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

/** List of previously generated podcasts for one deck. Newest first. */
export function useListDeckPodcasts(
  deckId: number,
  opts?: Partial<UseQueryOptions<PodcastFile[]>>,
) {
  return useQuery<PodcastFile[]>({
    queryKey: queryKeys.deckPodcasts(deckId),
    queryFn: () => api.podcast.list(deckId),
    enabled: Number.isFinite(deckId) && deckId > 0,
    ...opts,
  });
}

/**
 * Mutation: delete one podcast MP3. Invalidates the deck's podcast list.
 * Caller passes both `path` (for the actual delete call) and `deckId` (so
 * we can invalidate the right cache key).
 */
export function useDeletePodcast(
  opts?: UseMutationOptions<void, Error, { path: string; deckId: number }>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path }) => api.podcast.delete(path),
    ...opts,
    onSuccess: (data, variables, onMutateResult, context) => {
      qc.invalidateQueries({ queryKey: queryKeys.deckPodcasts(variables.deckId) });
      opts?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

/**
 * Mutation: transcribe a base64-encoded voice answer via OpenAI Whisper.
 * Stateless — no cache invalidation.
 */
export function useTranscribeVoiceAnswer(
  opts?: UseMutationOptions<
    string,
    Error,
    { audioBase64: string; mimeType: string; language?: string }
  >,
) {
  return useMutation({
    mutationFn: ({ audioBase64, mimeType, language }) =>
      api.whisper.transcribe(audioBase64, mimeType, language),
    ...opts,
  });
}

// ---------------------------------------------------------------------------
// Session 4 — FSRS optimizer
// ---------------------------------------------------------------------------

/**
 * Total `reviews` row count. Cheap (`COUNT(*)` on an indexed table) so the
 * Settings page polls it eagerly. We keep `staleTime` short — when the user
 * has just finished a session in another tab and comes back to settings, the
 * « keep revising » progress should reflect those fresh rows.
 */
export function useTotalReviewsCount(opts?: Partial<UseQueryOptions<number>>) {
  return useQuery<number>({
    queryKey: queryKeys.totalReviewsCount,
    queryFn: () => api.fsrsOptimizer.getTotalReviewsCount(),
    ...opts,
  });
}

/**
 * Mutation: re-fit the 21-element FSRS parameter vector on the user's
 * personal review log. Slow (5–30 s depending on row count) — callers should
 * keep the trigger disabled while `isPending` is true. On success we
 * invalidate every query that consumes scheduling decisions so the UI shows
 * the new intervals immediately.
 */
export function useOptimizeFsrsParams(
  opts?: UseMutationOptions<OptimizeResult, Error, { minReviews?: number | null }>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input) => api.fsrsOptimizer.optimize(input?.minReviews ?? null),
    ...opts,
    onSuccess: (data, variables, onMutateResult, context) => {
      // Newly-fitted parameters change every `next_states` preview and the
      // due queue (intervals may shift). Touch all schedule-flavoured caches.
      qc.invalidateQueries({ queryKey: ["next-states"] });
      qc.invalidateQueries({ queryKey: ["due-cards"] });
      qc.invalidateQueries({ queryKey: ["interleaved-due-cards"] });
      qc.invalidateQueries({ queryKey: queryKeys.todayStats });
      qc.invalidateQueries({ queryKey: queryKeys.totalReviewsCount });
      opts?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

// ---------------------------------------------------------------------------
// Vague 17 — Reading Import (LingQ-style word tracking)
// ---------------------------------------------------------------------------

/**
 * Look up the stored status of every word in `words` for `language`. Words
 * with no row are absent from the result — the component maps those to `new`.
 * `enabled` lets the caller hold the query until a text has been tokenised.
 */
export function useWordStatuses(
  words: string[],
  language: string,
  opts?: Partial<UseQueryOptions<WordStatus[]>>,
) {
  return useQuery({
    queryKey: queryKeys.wordStatuses(words, language),
    queryFn: () => api.reading.getWordStatuses(words, language),
    ...opts,
  });
}

/**
 * Upsert one word's status. Invalidates every `word-statuses` query so the
 * in-text highlight re-renders regardless of which word-set it was keyed by.
 */
export function useSetWordStatus(
  opts?: UseMutationOptions<
    WordStatus,
    Error,
    { word: string; status: WordStatusKind; language: string }
  >,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ word, status, language }) => api.reading.setWordStatus(word, status, language),
    ...opts,
    onSuccess: (data, variables, onMutateResult, context) => {
      qc.invalidateQueries({ queryKey: ["word-statuses"] });
      opts?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

/**
 * Create Basic cards from a batch of words. Touches the target deck's stats +
 * card list so the deck detail page reflects the freshly-minted notes.
 */
export function useCreateCardsFromWords(
  opts?: UseMutationOptions<
    number,
    Error,
    { deckId: number; words: string[]; translations?: string[] }
  >,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ deckId, words, translations }) =>
      api.reading.createCardsFromWords(deckId, words, translations ?? []),
    ...opts,
    onSuccess: (data, variables, onMutateResult, context) => {
      qc.invalidateQueries({ queryKey: queryKeys.deckStats(variables.deckId) });
      qc.invalidateQueries({ queryKey: ["cards-in-deck", variables.deckId] });
      opts?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

// ---------------------------------------------------------------------------
// Vague 21 — Implementation Intentions (study planner)
// ---------------------------------------------------------------------------

/** Every study plan, newest first. */
export function usePlans(opts?: Partial<UseQueryOptions<StudyPlan[]>>) {
  return useQuery<StudyPlan[]>({
    queryKey: queryKeys.studyPlans,
    queryFn: () => api.plans.list(),
    ...opts,
  });
}

/** Create a « si X alors Y » plan, then refresh the plan list. */
export function useCreatePlan(
  opts?: UseMutationOptions<
    StudyPlan,
    Error,
    {
      triggerType: PlanTriggerType;
      triggerValue: string;
      action: string;
      deckId?: number | null;
      days?: string;
      enabled?: boolean;
    }
  >,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => api.plans.create(data),
    ...opts,
    onSuccess: (data, variables, onMutateResult, context) => {
      qc.invalidateQueries({ queryKey: queryKeys.studyPlans });
      opts?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

/** Flip a plan's enabled flag, then refresh the plan list. */
export function useTogglePlan(
  opts?: UseMutationOptions<StudyPlan, Error, { id: number; enabled: boolean }>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, enabled }) => api.plans.toggle(id, enabled),
    ...opts,
    onSuccess: (data, variables, onMutateResult, context) => {
      qc.invalidateQueries({ queryKey: queryKeys.studyPlans });
      opts?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

/** Overwrite a plan's mutable fields, then refresh the plan list. */
export function useUpdatePlan(
  opts?: UseMutationOptions<
    StudyPlan,
    Error,
    {
      id: number;
      triggerType: PlanTriggerType;
      triggerValue: string;
      action: string;
      deckId?: number | null;
      days?: string;
      enabled: boolean;
    }
  >,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => api.plans.update(data),
    ...opts,
    onSuccess: (data, variables, onMutateResult, context) => {
      qc.invalidateQueries({ queryKey: queryKeys.studyPlans });
      opts?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

/** Delete a plan, then refresh the plan list. */
export function useDeletePlan(opts?: UseMutationOptions<void, Error, number>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.plans.delete(id),
    ...opts,
    onSuccess: (data, variables, onMutateResult, context) => {
      qc.invalidateQueries({ queryKey: queryKeys.studyPlans });
      opts?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

// Helper re-export so consumers can keep type-only imports tidy.
export type { Card };
