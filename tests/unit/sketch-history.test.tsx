/**
 * Tests for the sketch-history viewer surfaced in `<CardList />`
 * (Vague 7/25 — wiring the existing `get_card_sketches` backend into the UI).
 *
 * Coverage:
 *   - the « Voir les croquis » menu item opens a dialog that renders each saved
 *     sketch as an image (base64 PNG `data:` URL, used verbatim);
 *   - when a card has no sketches, the dialog shows the empty-state copy.
 *
 * Like the mnemonic-helper suite, the Radix `DropdownMenu` needs pointer /
 * scroll polyfills and `userEvent` to open. The Tauri-backed hooks are mocked.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CardState, CardWithNote, Sketch } from "@/lib/tauri";

const toastMock = vi.fn();

let cardsData: CardWithNote[] = [];
let sketchData: Sketch[] = [];

vi.mock("@/components/ui/use-toast", () => ({
  toast: (...args: unknown[]) => toastMock(...args),
  useToast: () => ({ toasts: [], toast: toastMock, dismiss: vi.fn() }),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("@/lib/queries", () => ({
  useCardsInDeck: () => ({ data: cardsData, isLoading: false, error: null }),
  useSearchNotes: () => ({ data: [], isLoading: false, error: null }),
  useSuspendCard: () => ({ mutate: vi.fn() }),
  useDeleteNote: () => ({ mutate: vi.fn() }),
  useResetCard: () => ({ mutate: vi.fn() }),
  useGenerateMnemonic: () => ({ mutate: vi.fn(), isPending: false }),
  useGenerateMnemonicImage: () => ({ mutate: vi.fn(), isPending: false }),
  useCardSketches: () => ({ data: sketchData, isLoading: false }),
}));

import { CardList } from "@/components/CardList";

function makeCard(): CardWithNote {
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
      scheduled_days: 5,
      reps: 1,
      lapses: 0,
      suspended: false,
      created_at: 0,
      updated_at: 0,
    },
    note: {
      id: 7,
      deck_id: 1,
      template: "basic",
      fields: { front: "Capitale de la France ?", back: "Paris" },
      tags: [],
      created_at: 0,
      updated_at: 0,
    },
  };
}

beforeAll(() => {
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
  toastMock.mockReset();
  cardsData = [makeCard()];
  sketchData = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CardList — sketch history", () => {
  it("renders saved sketches as images in the dialog", async () => {
    const png = "data:image/png;base64,iVBORw0KGgo=";
    sketchData = [
      { review_id: 1, card_id: 42, sketch_data: png, created_at: 1_700_000_000 },
      { review_id: 2, card_id: 42, sketch_data: png, created_at: 1_700_086_400 },
    ];
    const user = userEvent.setup();
    render(<CardList deckId={1} />);

    await user.click(screen.getByRole("button", { name: /Actions sur la carte/i }));
    await user.click(await screen.findByRole("menuitem", { name: /Voir les croquis/i }));

    const items = await screen.findAllByTestId("sketch-history-item");
    expect(items).toHaveLength(2);

    // The base64 payload is used verbatim as the <img> src.
    const imgs = screen.getAllByRole("img");
    expect(imgs.some((el) => el.getAttribute("src") === png)).toBe(true);
  });

  it("shows the empty-state copy when the card has no sketches", async () => {
    sketchData = [];
    const user = userEvent.setup();
    render(<CardList deckId={1} />);

    await user.click(screen.getByRole("button", { name: /Actions sur la carte/i }));
    await user.click(await screen.findByRole("menuitem", { name: /Voir les croquis/i }));

    expect(await screen.findByTestId("sketch-history-empty")).toBeInTheDocument();
    expect(screen.getByText(/Aucun croquis pour cette carte/i)).toBeInTheDocument();
  });
});
