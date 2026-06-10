/**
 * Smoke + interaction tests for `<AiGenerator />`.
 *
 * What we cover:
 *   - mounts the form when there are no decks (shows "create a deck first" hint)
 *   - mounts the form when decks are present + deck selector populated
 *   - "Générer" button is disabled until text is typed
 *   - the text-tab mutation is called with the chosen language and max-cards
 *   - generated draft cards become editable rows that can be removed
 *
 * The deck picker is a Radix `ui/select` (design.md bans native <select>), so
 * the selector test opens it through `@testing-library/user-event` and reads
 * the portaled options — same pattern as `note-editor-sentence.test.tsx`.
 *
 * What we DON'T cover here:
 *   - PDF picking (relies on @tauri-apps/plugin-dialog — mocked as a no-op)
 *   - real Claude calls (mocked: the mutation always succeeds with a static payload)
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const generateMutateAsync = vi.fn();
const createNoteMutateAsync = vi.fn();
const toastMock = vi.fn();

vi.mock("@/components/ui/use-toast", () => ({
  toast: (...args: unknown[]) => toastMock(...args),
  useToast: () => ({ toasts: [], toast: toastMock, dismiss: vi.fn() }),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(async () => null),
}));

let decksData: {
  id: number;
  name: string;
  color: string;
  description: string | null;
  desired_retention: number;
  scheduler_kind: "fsrs6" | "sm2" | "leitner";
  created_at: number;
  updated_at: number;
}[] = [];

vi.mock("@/lib/queries", () => ({
  useDecks: () => ({ data: decksData, isLoading: false }),
  useGenerateCardsFromText: () => ({
    mutateAsync: generateMutateAsync,
    isPending: false,
  }),
  // Vague 18 — local AI (Ollama) mutation. Stubbed so the existing tests
  // (which never opt into local mode) don't trip on a missing export.
  useGenerateCardsLocal: () => ({
    mutateAsync: vi.fn(async () => []),
    isPending: false,
  }),
  useGenerateCardsFromPdf: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  // Vague 5 — opt-in elaboration mutation. Stub it so the existing tests
  // don't trip on `useGenerateCardElaboration is not a function`.
  useGenerateCardElaboration: () => ({
    mutateAsync: vi.fn(async () => ({ why: "", example: "" })),
    isPending: false,
  }),
  // Vague 13 — opt-in critic mutation. Stubbed for the same reason; these
  // tests never opt into the critic pass so a no-op is enough.
  useCritiqueCards: () => ({
    mutateAsync: vi.fn(async () => []),
    isPending: false,
  }),
  useCreateNote: () => ({
    mutateAsync: createNoteMutateAsync,
    isPending: false,
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: { children: React.ReactNode; to?: string }) => (
    <a {...props}>{children}</a>
  ),
}));

import { AiGenerator } from "@/components/AiGenerator";

// Radix Select relies on Pointer Capture + scrollIntoView, absent from jsdom.
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => undefined;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => undefined;
  }
});

beforeEach(() => {
  generateMutateAsync.mockReset();
  createNoteMutateAsync.mockReset();
  toastMock.mockReset();
  decksData = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AiGenerator", () => {
  it("mounts and shows the form even when no decks exist", () => {
    render(<AiGenerator />);
    expect(screen.getByText(/Source.*paramètres/i)).toBeInTheDocument();
    expect(screen.getByText(/aucun deck disponible/i)).toBeInTheDocument();
  });

  it("populates the deck selector when decks are available", async () => {
    decksData = [
      {
        id: 1,
        name: "Spanish",
        color: "#3b82f6",
        description: null,
        desired_retention: 0.9,
        scheduler_kind: "fsrs6",
        created_at: 0,
        updated_at: 0,
      },
      {
        id: 2,
        name: "Biology",
        color: "#10b981",
        description: null,
        desired_retention: 0.9,
        scheduler_kind: "fsrs6",
        created_at: 0,
        updated_at: 0,
      },
    ];
    const user = userEvent.setup();
    render(<AiGenerator />);
    // Radix Select: the labelled trigger opens a portaled listbox of options.
    const trigger = screen.getByLabelText(/Deck cible/i);
    expect(trigger).toBeInTheDocument();
    await user.click(trigger);
    const options = await screen.findAllByRole("option");
    expect(options).toHaveLength(2);
    expect(screen.getByRole("option", { name: "Spanish" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Biology" })).toBeInTheDocument();
  });

  it("keeps the 'Générer' button disabled while the textarea is empty", () => {
    decksData = [
      {
        id: 1,
        name: "Spanish",
        color: "#3b82f6",
        description: null,
        desired_retention: 0.9,
        scheduler_kind: "fsrs6",
        created_at: 0,
        updated_at: 0,
      },
    ];
    render(<AiGenerator />);
    const btn = screen.getByRole("button", { name: /Générer/i });
    expect(btn).toBeDisabled();
  });

  it("calls the text-generation mutation with the typed payload", async () => {
    decksData = [
      {
        id: 7,
        name: "Lang",
        color: "#3b82f6",
        description: null,
        desired_retention: 0.9,
        scheduler_kind: "fsrs6",
        created_at: 0,
        updated_at: 0,
      },
    ];
    generateMutateAsync.mockResolvedValueOnce([]);

    render(<AiGenerator />);
    fireEvent.change(screen.getByLabelText(/Texte source/i), {
      target: { value: "Hello world content for generation." },
    });
    fireEvent.click(screen.getByRole("button", { name: /Générer/i }));

    await waitFor(() => {
      expect(generateMutateAsync).toHaveBeenCalledTimes(1);
    });
    expect(generateMutateAsync).toHaveBeenCalledWith({
      text: "Hello world content for generation.",
      maxCards: 10,
      language: "fr",
    });
  });

  it("renders generated drafts and lets the user drop one", async () => {
    decksData = [
      {
        id: 7,
        name: "Lang",
        color: "#3b82f6",
        description: null,
        desired_retention: 0.9,
        scheduler_kind: "fsrs6",
        created_at: 0,
        updated_at: 0,
      },
    ];
    generateMutateAsync.mockResolvedValueOnce([
      { template: "basic", fields: { front: "Q1", back: "A1" }, tags: [] },
      { template: "basic", fields: { front: "Q2", back: "A2" }, tags: ["bio"] },
    ]);

    render(<AiGenerator />);
    fireEvent.change(screen.getByLabelText(/Texte source/i), {
      target: { value: "Some content." },
    });
    fireEvent.click(screen.getByRole("button", { name: /Générer/i }));

    // Wait for the drafts to appear.
    await waitFor(() => {
      expect(screen.getByDisplayValue("Q1")).toBeInTheDocument();
    });
    expect(screen.getByDisplayValue("Q2")).toBeInTheDocument();

    // Drop the first card: aria-label is "Rejeter la carte N" from the X icon
    // button next to each draft.
    const dropFirst = screen.getByRole("button", { name: /rejeter la carte 1/i });
    fireEvent.click(dropFirst);

    await waitFor(() => {
      expect(screen.queryByDisplayValue("Q1")).not.toBeInTheDocument();
    });
    expect(screen.getByDisplayValue("Q2")).toBeInTheDocument();
  });
});
