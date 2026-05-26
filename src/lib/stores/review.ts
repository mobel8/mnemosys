/**
 * Ephemeral state for an in-progress review session.
 *
 * Stays in memory only — when the user closes the review page the queue is
 * dropped (any partial progress is already persisted server-side because
 * each `submit_review` is its own transaction). Used by both the review
 * page and the sidebar "current session" pill.
 */

import { create } from "zustand";
import type { CardWithNote } from "@/lib/tauri";

interface ReviewSessionState {
  deckId: number | null;
  /** FIFO queue of cards still to grade. */
  queue: CardWithNote[];
  /** Index inside `queue` of the card currently being graded. */
  currentIndex: number;
  /** Number of cards graded so far. */
  reviewedCount: number;
  /** Unix ms timestamp when the session started (used for review-time stats). */
  startedAt: number | null;
  /** Unix ms timestamp when the *current* card was first shown. */
  cardShownAt: number | null;

  startSession: (deckId: number | null, cards: CardWithNote[]) => void;
  /** Mark the current card as graded and advance the pointer. */
  advance: () => void;
  /** Reset everything (e.g. when leaving the review page). */
  reset: () => void;
  /** Re-mark the current card's "shown at" timestamp (e.g. after flipping). */
  markCardShown: () => void;
}

function initial() {
  return {
    deckId: null as number | null,
    queue: [] as CardWithNote[],
    currentIndex: 0,
    reviewedCount: 0,
    startedAt: null as number | null,
    cardShownAt: null as number | null,
  };
}

export const useReviewSession = create<ReviewSessionState>((set) => ({
  ...initial(),
  startSession(deckId, cards) {
    const now = Date.now();
    set({
      deckId,
      queue: cards,
      currentIndex: 0,
      reviewedCount: 0,
      startedAt: now,
      cardShownAt: now,
    });
  },
  advance() {
    set((s) => ({
      currentIndex: s.currentIndex + 1,
      reviewedCount: s.reviewedCount + 1,
      cardShownAt: Date.now(),
    }));
  },
  reset() {
    set(initial());
  },
  markCardShown() {
    set({ cardShownAt: Date.now() });
  },
}));

/** Convenience selector: the card currently being graded, or `null` when done. */
export function selectCurrentCard(state: ReviewSessionState): CardWithNote | null {
  return state.queue[state.currentIndex] ?? null;
}
