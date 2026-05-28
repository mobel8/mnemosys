/**
 * Smoke tests for `<PalaceBuilder />` and the palaces index page.
 *
 * R3F + WebGL crash in jsdom, so `<PalaceScene />` detects the missing
 * WebGL context and renders a fallback `<div data-testid="palace-scene-fallback">`.
 * That means we can mount the builder safely and assert on the surrounding
 * React UI without touching the 3D layer.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Mocks (must come before any import of the component under test) -------

const createMutate = vi.fn();
const addLocusMutate = vi.fn();
const removeLocusMutate = vi.fn();
const reorderMutate = vi.fn();
const toastMock = vi.fn();

vi.mock("@/components/ui/use-toast", () => ({
  toast: (...args: unknown[]) => toastMock(...args),
  useToast: () => ({ toasts: [], toast: toastMock, dismiss: vi.fn() }),
}));

vi.mock("@tanstack/react-router", () => ({
  // The components only call `useNavigate()` to fire-and-forget navigation,
  // so a stub function-returning hook is enough.
  useNavigate: () => vi.fn(),
  useParams: () => ({ palaceId: 42 }),
  Link: ({ children, to }: { children: React.ReactNode; to?: string }) => (
    <a href={to ?? "#"}>{children}</a>
  ),
}));

const palaceFixture = {
  id: 42,
  name: "My Test House",
  description: "A house for tests",
  template: "house" as const,
  created_at: 1_700_000_000,
  updated_at: 1_700_000_000,
  loci: [
    {
      id: 1,
      palace_id: 42,
      card_id: 100,
      x: 1,
      y: 1.7,
      z: 2,
      ordinal: 1,
      label: "kitchen sink",
      created_at: 1_700_000_001,
    },
    {
      id: 2,
      palace_id: 42,
      card_id: 101,
      x: 3,
      y: 1.7,
      z: -2,
      ordinal: 2,
      label: "front door",
      created_at: 1_700_000_002,
    },
  ],
};

vi.mock("@/lib/queries", () => ({
  usePalace: () => ({ data: palaceFixture, isLoading: false, isError: false }),
  usePalaces: () => ({
    data: [
      {
        id: 42,
        name: "My Test House",
        description: "A house for tests",
        template: "house",
        created_at: 1_700_000_000,
        updated_at: 1_700_000_000,
      },
    ],
    isLoading: false,
  }),
  useDecks: () => ({
    data: [
      { id: 1, name: "Spanish", color: "#3b82f6" },
      { id: 2, name: "Anatomy", color: "#ef4444" },
    ],
    isLoading: false,
  }),
  useCardsInDeck: () => ({
    data: [
      {
        card: { id: 200, note_id: 1, deck_id: 1, state: "new" },
        note: {
          id: 1,
          deck_id: 1,
          template: "basic",
          fields: { front: "Hola", back: "Hello" },
          tags: [],
          created_at: 0,
          updated_at: 0,
        },
      },
      {
        card: { id: 201, note_id: 2, deck_id: 1, state: "new" },
        note: {
          id: 2,
          deck_id: 1,
          template: "basic",
          fields: { front: "Adios", back: "Goodbye" },
          tags: [],
          created_at: 0,
          updated_at: 0,
        },
      },
    ],
    isLoading: false,
  }),
  useCreatePalace: () => ({ mutate: createMutate, isPending: false }),
  // Vague 9 — palace tiles now expose rename/delete; stub the mutations so the
  // index page mounts (these builder tests don't exercise those flows).
  useUpdatePalace: () => ({ mutate: vi.fn(), isPending: false }),
  useDeletePalace: () => ({ mutate: vi.fn(), isPending: false }),
  useAddPalaceLocus: () => ({ mutate: addLocusMutate, isPending: false }),
  useRemovePalaceLocus: () => ({ mutate: removeLocusMutate, isPending: false }),
  useReorderPalaceLoci: () => ({ mutate: reorderMutate, isPending: false }),
}));

import { PalaceBuilder } from "@/components/palaces/PalaceBuilder";
import PalacesIndexPage from "@/routes/palaces.page";

beforeEach(() => {
  createMutate.mockReset();
  addLocusMutate.mockReset();
  removeLocusMutate.mockReset();
  reorderMutate.mockReset();
  toastMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PalaceBuilder", () => {
  it("renders the palace name and the loci sidebar", () => {
    render(<PalaceBuilder palaceId={42} />);
    expect(screen.getByTestId("palace-name").textContent).toContain("My Test House");
    expect(screen.getByTestId("palace-loci-sidebar")).toBeInTheDocument();
    // Both loci should show up in the ordered list.
    expect(screen.getByText("kitchen sink")).toBeInTheDocument();
    expect(screen.getByText("front door")).toBeInTheDocument();
  });

  it("lists decks in the left sidebar", () => {
    render(<PalaceBuilder palaceId={42} />);
    expect(screen.getByTestId("palace-deck-sidebar")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Spanish" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Anatomy" })).toBeInTheDocument();
  });

  it("falls back to a non-WebGL placeholder inside the scene container", () => {
    render(<PalaceBuilder palaceId={42} />);
    // jsdom has no WebGL → the scene component renders its fallback.
    expect(screen.getByTestId("palace-scene-fallback")).toBeInTheDocument();
  });

  it("clicking arrow-up on a locus dispatches a reorder mutation", () => {
    render(<PalaceBuilder palaceId={42} />);
    // The second locus has a working "monter" button.
    const upButtons = screen.getAllByLabelText(/Monter dans l'ordre/i);
    expect(upButtons.length).toBeGreaterThan(0);
    // Index 1 is the second locus — clicking move-up swaps it with index 0.
    const second = upButtons[1];
    expect(second).toBeDefined();
    if (!second) return;
    fireEvent.click(second);
    expect(reorderMutate).toHaveBeenCalledTimes(1);
    const payload = reorderMutate.mock.calls[0]?.[0] as {
      palaceId: number;
      newOrder: number[];
    };
    expect(payload.palaceId).toBe(42);
    // [2, 1] — second locus moves to the front.
    expect(payload.newOrder).toEqual([2, 1]);
  });
});

describe("PalacesIndexPage", () => {
  it("renders the palaces index with the existing palace tile", () => {
    render(<PalacesIndexPage />);
    expect(screen.getByText(/Memory Palaces/i)).toBeInTheDocument();
    // Tile from the mocked usePalaces.
    expect(screen.getByText("My Test House")).toBeInTheDocument();
    // "Nouveau palace" call to action.
    expect(screen.getByRole("button", { name: /Nouveau palace/i })).toBeInTheDocument();
  });
});
