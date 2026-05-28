/**
 * Tests for `<ReadingImport />` (Vague 17 — LingQ-style reading).
 *
 * Coverage:
 *   1. Analysing a pasted text tokenises it into clickable word buttons and
 *      shows the coverage stats line.
 *   2. Clicking a word cycles its status (new → learning) and persists the
 *      change via `setWordStatus`.
 *   3. With a learning word + a chosen deck, "Créer des cartes" calls
 *      `createCardsFromWords` with exactly the learning words.
 *
 * The Tauri-backed query/mutation hooks are mocked; we assert on the call
 * arguments rather than any real IPC.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const setStatusMutate = vi.fn();
const createCardsMutate = vi.fn();
const toastMock = vi.fn();

// `word -> status` the mocked useWordStatuses query reports back.
let wordStatusRows: { word: string; language: string; status: string; updated_at: number }[] = [];

vi.mock("@/components/ui/use-toast", () => ({
  toast: (...args: unknown[]) => toastMock(...args),
  useToast: () => ({ toasts: [], toast: toastMock, dismiss: vi.fn() }),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: { children: React.ReactNode; to?: string }) => (
    <a {...props}>{children}</a>
  ),
}));

vi.mock("@/lib/queries", () => ({
  useDecks: () => ({
    data: [
      {
        id: 3,
        name: "Spanish",
        color: "#3b82f6",
        description: null,
        desired_retention: 0.9,
        scheduler_kind: "fsrs6",
        created_at: 0,
        updated_at: 0,
      },
    ],
    isLoading: false,
  }),
  useWordStatuses: () => ({ data: wordStatusRows, isLoading: false }),
  useSetWordStatus: () => ({ mutate: setStatusMutate, isPending: false }),
  useCreateCardsFromWords: () => ({ mutate: createCardsMutate, isPending: false }),
}));

import { ReadingImport, tokenize } from "@/components/ReadingImport";

beforeEach(() => {
  setStatusMutate.mockReset();
  createCardsMutate.mockReset();
  toastMock.mockReset();
  wordStatusRows = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Submit a text into the reader (fill textarea + click "Analyser"). */
function analyzeText(text: string) {
  fireEvent.change(screen.getByLabelText(/Colle un article/i), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: /Analyser le texte/i }));
}

describe("tokenize", () => {
  it("splits words from punctuation while preserving the original text", () => {
    const tokens = tokenize("Hola, mundo!");
    const words = tokens.filter((t) => t.isWord).map((t) => t.normalized);
    expect(words).toEqual(["hola", "mundo"]);
    // Re-joining every raw segment must reproduce the input verbatim.
    expect(tokens.map((t) => t.raw).join("")).toBe("Hola, mundo!");
  });
});

describe("ReadingImport", () => {
  it("tokenises the analysed text into word buttons with coverage stats", async () => {
    render(<ReadingImport />);
    analyzeText("the cat sat");

    await waitFor(() => {
      expect(screen.getAllByTestId("reading-word")).toHaveLength(3);
    });
    // All three words are unknown by default, so 0% coverage.
    const stats = screen.getByTestId("reading-stats");
    expect(stats).toHaveTextContent("3");
    expect(stats).toHaveTextContent("0%");
  });

  it("cycles a word's status and persists it on click", async () => {
    render(<ReadingImport />);
    analyzeText("bonjour");

    const word = await screen.findByTestId("reading-word");
    expect(word).toHaveAttribute("data-status", "new");

    fireEvent.click(word);

    // Optimistic flip to "learning" + a persisted mutation.
    await waitFor(() => {
      expect(word).toHaveAttribute("data-status", "learning");
    });
    expect(setStatusMutate).toHaveBeenCalledTimes(1);
    expect(setStatusMutate.mock.calls[0]?.[0]).toMatchObject({
      word: "bonjour",
      status: "learning",
      language: "en",
    });
  });

  it("creates cards from the words marked learning", async () => {
    // Pre-seed one word as already "learning" so the button is enabled.
    wordStatusRows = [{ word: "gato", language: "en", status: "learning", updated_at: 0 }];
    render(<ReadingImport />);

    // Pick the target deck.
    fireEvent.change(screen.getByLabelText(/Deck cible/i), { target: { value: "3" } });
    analyzeText("gato perro");

    const createBtn = await screen.findByTestId("create-cards-button");
    await waitFor(() => expect(createBtn).toBeEnabled());
    fireEvent.click(createBtn);

    expect(createCardsMutate).toHaveBeenCalledTimes(1);
    expect(createCardsMutate.mock.calls[0]?.[0]).toMatchObject({
      deckId: 3,
      words: ["gato"],
    });
  });
});
