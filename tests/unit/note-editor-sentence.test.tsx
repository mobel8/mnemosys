/**
 * Unit tests for the Vague 10 "Phrase" tab of the NoteEditor.
 *
 * The tab maps to the backend `bidirectional` template (two cards, L2↔L1)
 * and adds source / target / hint inputs plus a frequency-band dropdown.
 *
 * Like `note-editor.test.tsx`, we mock `@/lib/queries`' `useCreateNote` and
 * the toast hook so the editor's submit path is observable in isolation.
 * Radix Tabs activate on pointer events, so all interactions go through
 * `@testing-library/user-event`.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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
  mutateMock.mockReset();
  toastMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function getSubmitButton() {
  return screen.getByRole("button", { name: /^Ajouter(\s|$)/ });
}

async function openPhraseTab(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("tab", { name: /Phrase/ }));
}

describe("NoteEditor — Phrase tab", () => {
  it("renders the Phrase tab inputs (source, target, hint, frequency band)", async () => {
    const user = userEvent.setup();
    render(<NoteEditor deckId={1} />);
    await openPhraseTab(user);
    expect(screen.getByLabelText(/Phrase \(langue cible\)/)).toBeInTheDocument();
    expect(screen.getByLabelText("Traduction")).toBeInTheDocument();
    expect(screen.getByLabelText(/Indice \/ note/)).toBeInTheDocument();
    expect(screen.getByLabelText("Bande de fréquence")).toBeInTheDocument();
  });

  it("refuses to submit when source or target is empty", async () => {
    const user = userEvent.setup();
    render(<NoteEditor deckId={1} />);
    await openPhraseTab(user);
    // Fill only the source — target stays empty.
    await user.type(screen.getByLabelText(/Phrase \(langue cible\)/), "Hallo");
    await user.click(getSubmitButton());
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "destructive",
        title: expect.stringMatching(/Champs incomplets/i),
      }),
    );
    expect(mutateMock).not.toHaveBeenCalled();
  });

  it("submits a bidirectional note with the chosen frequency band", async () => {
    const user = userEvent.setup();
    render(<NoteEditor deckId={7} />);
    await openPhraseTab(user);
    await user.type(screen.getByLabelText(/Phrase \(langue cible\)/), "Hallo Welt");
    await user.type(screen.getByLabelText("Traduction"), "Bonjour le monde");
    await user.type(screen.getByLabelText(/Indice \/ note/), "salutation");
    // Frequency band is now a Radix <Select> (P071) — open it, pick the option.
    await user.click(screen.getByLabelText("Bande de fréquence"));
    await user.click(await screen.findByRole("option", { name: "Top 100" }));
    await user.click(getSubmitButton());
    expect(mutateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        deckId: 7,
        template: "bidirectional",
        fields: { source: "Hallo Welt", target: "Bonjour le monde", hint: "salutation" },
        frequencyBand: "top_100",
      }),
    );
  });
});
