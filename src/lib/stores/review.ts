/**
 * Ephemeral "is a review session in progress?" signal.
 *
 * Stays in memory only — when the user closes the review page the signal is
 * dropped (any partial progress is already persisted server-side because each
 * `submit_review` is its own transaction).
 *
 * P122 — this store deliberately holds nothing more than the active session's
 * `deckId`. The full live queue is owned by `<ReviewSession>` local state
 * (which `suspend`, hands-free, and the rating flow all mutate), so mirroring
 * `queue` / `currentIndex` / `reviewedCount` here only created a second source
 * of truth that silently drifted out of sync (e.g. suspend removed a card
 * locally but never advanced the store). The only live consumers —
 * `MovementBreakReminder` and `DelayedJolPrompt` — just need to know whether a
 * session is active, which `deckId !== null` answers reliably.
 */

import { create } from "zustand";
import type { CardWithNote } from "@/lib/tauri";

interface ReviewSessionState {
  /** Deck of the active session, or `null` when no session is in progress.
   * `< 0` is the interleaved-session sentinel. This is the canonical
   * "a session is in progress" signal: `deckId !== null`. */
  deckId: number | null;
  /** Unix ms timestamp when the session started. */
  startedAt: number | null;

  /** Begin a session for `deckId`. `cards` is accepted for call-site symmetry
   * with the queue snapshot but is not retained (the queue lives in the
   * session component). */
  startSession: (deckId: number | null, cards: CardWithNote[]) => void;
  /** Reset everything (e.g. when leaving the review page). */
  reset: () => void;
}

export const useReviewSession = create<ReviewSessionState>((set) => ({
  deckId: null,
  startedAt: null,
  startSession(deckId, _cards) {
    set({ deckId, startedAt: Date.now() });
  },
  reset() {
    set({ deckId: null, startedAt: null });
  },
}));
