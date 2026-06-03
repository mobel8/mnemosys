/**
 * Unit tests for the Vague 14 "Médecine" tab of the NoteEditor.
 *
 * The tab maps to the backend `illness_script` template (one card, Charlin
 * 2007). It exposes a required `condition` plus four optional clinical
 * sections; submitting requires the condition AND at least one section.
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
  useUpdateNote: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
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

async function openMedecineTab(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("tab", { name: /Médecine/ }));
}

describe("NoteEditor — Médecine (illness script) tab", () => {
  it("submits an illness_script note with condition and filled sections", async () => {
    const user = userEvent.setup();
    render(<NoteEditor deckId={4} />);
    await openMedecineTab(user);

    await user.type(screen.getByLabelText(/Condition \/ diagnostic/), "Infarctus du myocarde");
    await user.type(screen.getByLabelText("Clinique"), "Douleur thoracique constrictive");
    await user.type(screen.getByLabelText("Prise en charge"), "Reperfusion en urgence");
    await user.click(getSubmitButton());

    expect(mutateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        deckId: 4,
        template: "illness_script",
        fields: {
          condition: "Infarctus du myocarde",
          clinical: "Douleur thoracique constrictive",
          management: "Reperfusion en urgence",
        },
      }),
    );
  });

  it("refuses to submit when the condition has no clinical section filled", async () => {
    const user = userEvent.setup();
    render(<NoteEditor deckId={1} />);
    await openMedecineTab(user);

    // Condition present but every section left blank.
    await user.type(screen.getByLabelText(/Condition \/ diagnostic/), "Asthme");
    await user.click(getSubmitButton());

    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "destructive",
        title: expect.stringMatching(/Fiche incomplète/i),
      }),
    );
    expect(mutateMock).not.toHaveBeenCalled();
  });
});
