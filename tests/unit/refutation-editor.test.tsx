/**
 * Unit tests for the Vague 14 "Sciences" tab of the NoteEditor.
 *
 * The tab maps to the backend `refutation` template (one card, Tippett 2010
 * meta). It requires a `misconception` and its `correct` counterpart, with an
 * optional `explanation`.
 *
 * Like `note-editor-sentence.test.tsx`, we mock `@/lib/queries`' `useCreateNote`
 * and the toast hook so the editor's submit path is observable in isolation.
 * Radix Tabs activate on pointer events, so interactions go through
 * `@testing-library/user-event`.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mutateMock = vi.fn();
const toastMock = vi.fn();

vi.mock("@/components/ui/use-toast", () => ({
  toast: (...args: unknown[]) => toastMock(...args),
  useToast: () => ({ toasts: [], toast: toastMock, dismiss: vi.fn() }),
}));

vi.mock("@/lib/queries", () => ({
  useCreateNote: () => ({
    mutate: (vars: unknown, opts?: { onSuccess?: () => void }) => {
      mutateMock(vars);
      opts?.onSuccess?.();
    },
    isPending: false,
  }),
  useSettingsQuery: () => ({ data: undefined, isLoading: false }),
  useSynthesizeAudio: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { NoteEditor } from "@/components/NoteEditor";

beforeEach(() => {
  mutateMock.mockReset();
  toastMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function getSubmitButton() {
  return screen.getByRole("button", { name: /^Ajouter(\s|$)/ });
}

async function openSciencesTab(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("tab", { name: /Sciences/ }));
}

describe("NoteEditor — Sciences (refutation) tab", () => {
  it("submits a refutation note with misconception, correction and explanation", async () => {
    const user = userEvent.setup();
    render(<NoteEditor deckId={9} />);
    await openSciencesTab(user);

    await user.type(
      screen.getByLabelText(/Idée fausse/),
      "Les saisons sont dues à la distance Terre-Soleil.",
    );
    await user.type(
      screen.getByLabelText(/Correction/),
      "Les saisons sont dues à l'inclinaison de l'axe terrestre.",
    );
    await user.type(screen.getByLabelText(/Explication/), "L'orbite est quasi circulaire.");
    await user.click(getSubmitButton());

    expect(mutateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        deckId: 9,
        template: "refutation",
        fields: {
          misconception: "Les saisons sont dues à la distance Terre-Soleil.",
          correct: "Les saisons sont dues à l'inclinaison de l'axe terrestre.",
          explanation: "L'orbite est quasi circulaire.",
        },
      }),
    );
  });

  it("refuses to submit when the misconception or correction is empty", async () => {
    const user = userEvent.setup();
    render(<NoteEditor deckId={1} />);
    await openSciencesTab(user);

    // Fill only the misconception — the correction stays empty.
    await user.type(screen.getByLabelText(/Idée fausse/), "La foudre ne frappe jamais deux fois.");
    await user.click(getSubmitButton());

    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "destructive",
        title: expect.stringMatching(/Champs incomplets/i),
      }),
    );
    expect(mutateMock).not.toHaveBeenCalled();
  });
});
