/**
 * Smoke + interaction tests for `<InterleavedSession />` (Vague 5).
 *
 * Coverage:
 *   - shows the empty-decks hint when no decks exist
 *   - renders one checkbox per deck once decks load
 *   - keeps the « Démarrer » button disabled until at least one deck is ticked
 *   - flips into the « loading » state when start is clicked with selections
 *
 * What we don't cover:
 *   - the actual `<ReviewSession />` handoff (covered separately by the
 *     existing review-controls / review-format tests + e2e).
 *   - real Tauri IPC (the queries hook is mocked here).
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const interleavedRefetch = vi.fn();
const toastMock = vi.fn();

interface MockDeck {
  id: number;
  name: string;
  color: string;
  description: string | null;
  desired_retention: number;
  scheduler_kind: "fsrs6" | "sm2" | "leitner";
  created_at: number;
  updated_at: number;
}

let decksData: MockDeck[] = [];
let interleavedData: unknown[] = [];
let interleavedIsLoading = false;
let interleavedError: { message: string } | null = null;

vi.mock("@/components/ui/use-toast", () => ({
  toast: (...args: unknown[]) => toastMock(...args),
  useToast: () => ({ toasts: [], toast: toastMock, dismiss: vi.fn() }),
}));

vi.mock("@/lib/queries", () => ({
  useDecks: () => ({ data: decksData, isLoading: false }),
  useInterleavedDueCards: () => ({
    data: interleavedData,
    isLoading: interleavedIsLoading,
    error: interleavedError,
    refetch: interleavedRefetch,
  }),
}));

// `<ReviewSession>` pulls in TanStack Router + react-hotkeys-hook + a stack
// of dependencies we don't need to exercise here. Stub it with a marker so
// the « cards loaded → session running » transition is observable without
// booting the entire review state machine.
vi.mock("@/components/ReviewSession", () => ({
  ReviewSession: ({ cards }: { cards: { card: { id: number } }[] }) => (
    <div data-testid="review-session-stub">stub session ({cards.length} cartes)</div>
  ),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children, ...props }: { children: React.ReactNode; to?: string }) => (
    <a {...props}>{children}</a>
  ),
}));

import { InterleavedSession } from "@/components/InterleavedSession";

const makeDeck = (overrides: Partial<MockDeck> & Pick<MockDeck, "id" | "name">): MockDeck => ({
  color: "#3b82f6",
  description: null,
  desired_retention: 0.9,
  scheduler_kind: "fsrs6",
  created_at: 0,
  updated_at: 0,
  ...overrides,
});

beforeEach(() => {
  decksData = [];
  interleavedData = [];
  interleavedIsLoading = false;
  interleavedError = null;
  interleavedRefetch.mockReset();
  toastMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("InterleavedSession", () => {
  it("shows a helpful hint when no decks exist", () => {
    render(<InterleavedSession />);
    expect(screen.getByText(/Decks à mélanger/i)).toBeInTheDocument();
    expect(screen.getByText(/Aucun deck disponible/i)).toBeInTheDocument();
  });

  it("renders one checkbox per deck", () => {
    decksData = [
      makeDeck({ id: 1, name: "Espagnol" }),
      makeDeck({ id: 2, name: "Biologie", color: "#10b981" }),
      makeDeck({ id: 3, name: "Histoire", color: "#f59e0b" }),
    ];
    render(<InterleavedSession />);
    expect(screen.getByLabelText(/Inclure « Espagnol »/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Inclure « Biologie »/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Inclure « Histoire »/i)).toBeInTheDocument();
  });

  it("keeps the start button disabled until a deck is checked", () => {
    decksData = [makeDeck({ id: 1, name: "Espagnol" })];
    render(<InterleavedSession />);
    const startBtn = screen.getByRole("button", {
      name: /Démarrer la session entrelacée/i,
    });
    expect(startBtn).toBeDisabled();

    fireEvent.click(screen.getByLabelText(/Inclure « Espagnol »/i));
    expect(startBtn).toBeEnabled();
  });

  it("hands off to the review session once start is clicked", async () => {
    decksData = [
      makeDeck({ id: 1, name: "Espagnol" }),
      makeDeck({ id: 2, name: "Biologie", color: "#10b981" }),
    ];
    interleavedData = [
      { card: { id: 100, deck_id: 1 }, note: { id: 10, deck_id: 1, fields: {}, tags: [] } },
      { card: { id: 200, deck_id: 2 }, note: { id: 20, deck_id: 2, fields: {}, tags: [] } },
    ];
    render(<InterleavedSession />);

    fireEvent.click(screen.getByLabelText(/Inclure « Espagnol »/i));
    fireEvent.click(screen.getByLabelText(/Inclure « Biologie »/i));
    fireEvent.click(screen.getByRole("button", { name: /Démarrer la session entrelacée/i }));

    await waitFor(() => {
      expect(screen.getByTestId("review-session-stub")).toBeInTheDocument();
    });
    expect(screen.getByTestId("review-session-stub")).toHaveTextContent("2 cartes");
  });
});
