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
  type AppSettings,
  api,
  type Card,
  type CardWithNote,
  type ConversionResult,
  type DayCount,
  type DayRetention,
  type Deck,
  type DeckPatch,
  type DeckStats,
  type GeneratedCard,
  type ImportResult,
  type NextStates,
  type Note,
  type NoteTemplate,
  type Rating,
  type ReviewResult,
  type SyncLoginOutput,
  type SyncReport,
  type SyncStatus,
  type TodayStats,
  type TTSResult,
  type TTSVoice,
} from "@/lib/tauri";

export const queryKeys = {
  decks: ["decks"] as const,
  deck: (id: number) => ["deck", id] as const,
  deckStats: (id: number) => ["deck-stats", id] as const,
  cardsInDeck: (deckId: number, limit: number, offset: number) =>
    ["cards-in-deck", deckId, limit, offset] as const,
  dueCards: (deckId: number | null, limit: number) => ["due-cards", deckId, limit] as const,
  nextStates: (cardId: number) => ["next-states", cardId] as const,
  searchNotes: (query: string, limit: number) => ["search-notes", query, limit] as const,
  todayStats: ["today-stats"] as const,
  reviewsByDay: (days: number) => ["reviews-by-day", days] as const,
  retentionByDay: (days: number) => ["retention-by-day", days] as const,
  settings: ["settings"] as const,
  ttsCacheSize: ["tts-cache-size"] as const,
  syncStatus: ["sync-status"] as const,
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

export function useDueCards(
  deckId: number | null,
  limit = 100,
  opts?: Partial<UseQueryOptions<CardWithNote[]>>,
) {
  return useQuery<CardWithNote[]>({
    queryKey: queryKeys.dueCards(deckId, limit),
    queryFn: () => api.review.dueCards(deckId, limit),
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
      opts?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

export function useSubmitReview(
  opts?: UseMutationOptions<
    ReviewResult,
    Error,
    { cardId: number; rating: Rating; reviewTimeMs: number }
  >,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input) => api.review.submit(input),
    ...opts,
    onSuccess: (data, variables, onMutateResult, context) => {
      // Affects stats + the due queue for the deck this card belongs to.
      qc.invalidateQueries({ queryKey: queryKeys.todayStats });
      qc.invalidateQueries({ queryKey: ["due-cards"] });
      qc.invalidateQueries({ queryKey: ["reviews-by-day"] });
      qc.invalidateQueries({ queryKey: ["retention-by-day"] });
      qc.invalidateQueries({ queryKey: ["deck-stats", data.card.deck_id] });
      qc.invalidateQueries({ queryKey: queryKeys.nextStates(variables.cardId) });
      opts?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
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
 * Mutation: synthesise (or cache-hit) speech. Result includes the on-disk
 * path; pass through `convertFileSrc()` before assigning to `<audio src>`.
 * Invalidates the cache-size query when the call was a miss.
 */
export function useSynthesizeAudio(
  opts?: UseMutationOptions<TTSResult, Error, { text: string; voice: TTSVoice; speed?: number }>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ text, voice, speed }) => api.tts.synthesize(text, voice, speed),
    ...opts,
    onSuccess: (data, variables, onMutateResult, context) => {
      if (!data.cached) {
        qc.invalidateQueries({ queryKey: queryKeys.ttsCacheSize });
      }
      opts?.onSuccess?.(data, variables, onMutateResult, context);
    },
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

// ---------------------------------------------------------------------------
// Session 3 — Cloud sync (Supabase scaffolding)
// ---------------------------------------------------------------------------

/** Snapshot used by the Settings UI to pick which sub-form to render. */
export function useSyncStatus(opts?: Partial<UseQueryOptions<SyncStatus>>) {
  return useQuery<SyncStatus>({
    queryKey: queryKeys.syncStatus,
    queryFn: () => api.sync.status(),
    ...opts,
  });
}

/**
 * Mutation: log in to Supabase. Invalidates the sync-status query so the
 * UI flips to « logged in » without an explicit refetch.
 */
export function useSyncLogin(
  opts?: UseMutationOptions<SyncLoginOutput, Error, { email: string; password: string }>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ email, password }) => api.sync.login(email, password),
    ...opts,
    onSuccess: (data, variables, onMutateResult, context) => {
      qc.invalidateQueries({ queryKey: queryKeys.syncStatus });
      opts?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

/** Mutation: clear the local session + best-effort server-side revoke. */
export function useSyncLogout(opts?: UseMutationOptions<void, Error, void>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.sync.logout(),
    ...opts,
    onSuccess: (data, variables, onMutateResult, context) => {
      qc.invalidateQueries({ queryKey: queryKeys.syncStatus });
      opts?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

/**
 * Mutation: run one full sync cycle. Invalidates every entity that the cycle
 * could have mutated (decks, notes, cards, stats) plus the sync status so
 * `last_sync_at` refreshes in the UI.
 */
export function useSyncNow(opts?: UseMutationOptions<SyncReport, Error, void>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.sync.now(),
    ...opts,
    onSuccess: (data, variables, onMutateResult, context) => {
      qc.invalidateQueries({ queryKey: queryKeys.decks });
      qc.invalidateQueries({ queryKey: ["deck-stats"] });
      qc.invalidateQueries({ queryKey: ["cards-in-deck"] });
      qc.invalidateQueries({ queryKey: ["due-cards"] });
      qc.invalidateQueries({ queryKey: queryKeys.todayStats });
      qc.invalidateQueries({ queryKey: ["reviews-by-day"] });
      qc.invalidateQueries({ queryKey: ["retention-by-day"] });
      qc.invalidateQueries({ queryKey: queryKeys.syncStatus });
      opts?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

// Helper re-export so consumers can keep type-only imports tidy.
export type { Card };
