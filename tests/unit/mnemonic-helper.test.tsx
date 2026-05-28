/**
 * Tests for the Vague 13 mnemonic helper surfaced in `<CardList />`.
 *
 * Targets (per spec):
 *   - the « Aide mnémotechnique » menu item appears only for high-lapse cards
 *     (lapses >= 3) and triggers the mnemonic mutation with the card id;
 *   - the generated aid is shown to the learner in the dialog.
 *
 * The Radix `DropdownMenu` relies on pointer-capture / scroll APIs that jsdom
 * doesn't implement, so we polyfill them before mounting (same trick the rest
 * of the suite uses for `ResizeObserver`).
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CardState, CardWithNote } from "@/lib/tauri";

const mnemonicMutate = vi.fn();
const toastMock = vi.fn();

vi.mock("@/components/ui/use-toast", () => ({
  toast: (...args: unknown[]) => toastMock(...args),
  useToast: () => ({ toasts: [], toast: toastMock, dismiss: vi.fn() }),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

let cardsData: CardWithNote[] = [];
let mnemonicPending = false;

vi.mock("@/lib/queries", () => ({
  useCardsInDeck: () => ({ data: cardsData, isLoading: false, error: null }),
  useSearchNotes: () => ({ data: [], isLoading: false, error: null }),
  useSuspendCard: () => ({ mutate: vi.fn() }),
  useDeleteNote: () => ({ mutate: vi.fn() }),
  useResetCard: () => ({ mutate: vi.fn() }),
  useGenerateMnemonic: (opts?: {
    onSuccess?: (text: string) => void;
    onError?: (err: Error) => void;
  }) => ({
    mutate: (vars: { cardId: number; language: string }) => {
      mnemonicMutate(vars);
      // Drive the controlled dialog the way the real hook would on success.
      opts?.onSuccess?.("Imagine un éléphant rose qui récite la réponse.");
    },
    isPending: mnemonicPending,
  }),
  // Vague 22 — image mnemonic hook (used by the same menu); a no-op stub is
  // enough since these tests only exercise the text-mnemonic flow.
  useGenerateMnemonicImage: (_opts?: {
    onSuccess?: (path: string) => void;
    onError?: (err: Error) => void;
  }) => ({
    mutate: vi.fn(),
    isPending: false,
  }),
}));

import { CardList } from "@/components/CardList";

/** Build a `CardWithNote` with a controllable `lapses` count. */
function makeCard(lapses: number): CardWithNote {
  return {
    card: {
      id: 42,
      note_id: 7,
      deck_id: 1,
      card_ord: 0,
      state: "review" as CardState,
      stability: 10,
      difficulty: 5,
      last_review: null,
      next_review: null,
      elapsed_days: 0,
      scheduled_days: 0,
      reps: 8,
      lapses,
      suspended: false,
      created_at: 0,
      updated_at: 0,
    },
    note: {
      id: 7,
      deck_id: 1,
      template: "basic",
      fields: { front: "Capitale du Pérou ?", back: "Lima" },
      tags: [],
      created_at: 0,
      updated_at: 0,
    },
  };
}

beforeAll(() => {
  // Radix DropdownMenu calls these on the trigger / items; jsdom lacks them.
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => undefined;
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => undefined;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => undefined;
  }
});

beforeEach(() => {
  mnemonicMutate.mockReset();
  toastMock.mockReset();
  cardsData = [];
  mnemonicPending = false;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CardList — mnemonic helper", () => {
  it("hides the mnemonic item for a low-lapse card", async () => {
    cardsData = [makeCard(1)];
    const user = userEvent.setup();
    render(<CardList deckId={1} />);

    await user.click(screen.getByRole("button", { name: /Actions sur la carte/i }));

    await waitFor(() => {
      expect(screen.getByRole("menuitem", { name: /Supprimer la note/i })).toBeInTheDocument();
    });
    expect(
      screen.queryByRole("menuitem", { name: /Aide mnémotechnique/i }),
    ).not.toBeInTheDocument();
  });

  it("generates and displays a mnemonic for a high-lapse card", async () => {
    cardsData = [makeCard(4)];
    const user = userEvent.setup();
    render(<CardList deckId={1} />);

    await user.click(screen.getByRole("button", { name: /Actions sur la carte/i }));

    const item = await screen.findByRole("menuitem", { name: /Aide mnémotechnique/i });
    await user.click(item);

    // The mutation fires with the card id + a language hint.
    await waitFor(() => {
      expect(mnemonicMutate).toHaveBeenCalledTimes(1);
    });
    expect(mnemonicMutate).toHaveBeenCalledWith({ cardId: 42, language: "fr" });

    // The generated aid is rendered in the dialog.
    await waitFor(() => {
      expect(screen.getByTestId("mnemonic-text")).toHaveTextContent(/éléphant rose/i);
    });
  });
});
