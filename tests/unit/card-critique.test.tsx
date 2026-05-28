/**
 * Tests for the Vague 13 « critic » pass surfaced in `<AiGenerator />`.
 *
 * Targets (per spec):
 *   - the quality badge renders on a draft after the critic pass runs;
 *   - clicking « Appliquer la correction » swaps the draft for the suggested
 *     fix and removes the suggestion affordance.
 *
 * Everything network-flavoured is mocked: generation returns a static card,
 * the critic mutation returns a static verdict carrying a `suggested_fix`.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const generateMutateAsync = vi.fn();
const critiqueMutateAsync = vi.fn();
const toastMock = vi.fn();

vi.mock("@/components/ui/use-toast", () => ({
  toast: (...args: unknown[]) => toastMock(...args),
  useToast: () => ({ toasts: [], toast: toastMock, dismiss: vi.fn() }),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(async () => null),
}));

const decksData = [
  {
    id: 1,
    name: "Bio",
    color: "#10b981",
    description: null,
    desired_retention: 0.9,
    scheduler_kind: "fsrs6" as const,
    created_at: 0,
    updated_at: 0,
  },
];

vi.mock("@/lib/queries", () => ({
  useDecks: () => ({ data: decksData, isLoading: false }),
  useGenerateCardsFromText: () => ({ mutateAsync: generateMutateAsync, isPending: false }),
  useGenerateCardsFromPdf: () => ({ mutateAsync: vi.fn(), isPending: false }),
  // V18 — Ollama local generation toggle. Stubbed: these tests never opt
  // into local mode, so a no-op keeps AiGenerator renderable.
  useGenerateCardsLocal: () => ({ mutateAsync: vi.fn(async () => []), isPending: false }),
  useGenerateCardElaboration: () => ({
    mutateAsync: vi.fn(async () => ({ why: "", example: "" })),
    isPending: false,
  }),
  useCritiqueCards: () => ({ mutateAsync: critiqueMutateAsync, isPending: false }),
  useCreateNote: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: { children: React.ReactNode; to?: string }) => (
    <a {...props}>{children}</a>
  ),
}));

import { AiGenerator } from "@/components/AiGenerator";

/** Drive the form: type text, opt into the critic pass, click Générer. */
async function generateWithCritique() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/Texte source/i), "Some study content.");
  await user.click(screen.getByLabelText(/Vérification qualité IA/i));
  await user.click(screen.getByRole("button", { name: /Générer/i }));
}

beforeEach(() => {
  generateMutateAsync.mockReset();
  critiqueMutateAsync.mockReset();
  toastMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AiGenerator — critic pass", () => {
  it("renders a quality badge on each draft after the critic runs", async () => {
    generateMutateAsync.mockResolvedValueOnce([
      { template: "basic", fields: { front: "Q1", back: "A1" }, tags: [] },
    ]);
    critiqueMutateAsync.mockResolvedValueOnce([
      { card_index: 0, score: 0.92, issues: [], suggested_fix: null },
    ]);

    render(<AiGenerator />);
    await generateWithCritique();

    await waitFor(() => {
      expect(screen.getByTestId("critique-badge-0")).toBeInTheDocument();
    });
    // Score is rendered as a rounded percentage.
    expect(screen.getByTestId("critique-badge-0")).toHaveTextContent("92%");
    // A clean card carries no « apply fix » affordance.
    expect(screen.queryByTestId("apply-fix-0")).not.toBeInTheDocument();
  });

  it("applies the suggested fix and drops the suggestion when clicked", async () => {
    generateMutateAsync.mockResolvedValueOnce([
      { template: "basic", fields: { front: "Vague Q", back: "Vague A" }, tags: [] },
    ]);
    critiqueMutateAsync.mockResolvedValueOnce([
      {
        card_index: 0,
        score: 0.4,
        issues: ["Réponse ambiguë"],
        suggested_fix: {
          template: "basic",
          fields: { front: "Question corrigée ?", back: "Réponse claire" },
          tags: ["fixed"],
        },
      },
    ]);

    render(<AiGenerator />);
    await generateWithCritique();

    // The fix button appears for the low-scoring card.
    const applyBtn = await screen.findByTestId("apply-fix-0");
    // Original draft content is still on screen pre-apply.
    expect(screen.getByDisplayValue("Vague Q")).toBeInTheDocument();

    await userEvent.setup().click(applyBtn);

    // After applying: the corrected text replaces the original and the
    // suggestion affordance disappears.
    await waitFor(() => {
      expect(screen.getByDisplayValue("Question corrigée ?")).toBeInTheDocument();
    });
    expect(screen.getByDisplayValue("Réponse claire")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Vague Q")).not.toBeInTheDocument();
    expect(screen.queryByTestId("apply-fix-0")).not.toBeInTheDocument();
  });
});
