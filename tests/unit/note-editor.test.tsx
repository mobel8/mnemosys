/**
 * Unit tests for the NoteEditor and its companion ClozePreview helpers.
 *
 * We don't spin up the full TanStack Query provider for every test; instead
 * we mock `@/lib/queries`' `useCreateNote` so the editor's submit path is
 * observable in isolation. The toast hook is also mocked so we can assert
 * that validation surfaces user-facing errors.
 *
 * Note: Radix Tabs activates on pointer events, not `click` events, so all
 * interactions in this file go through `@testing-library/user-event`.
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
}));

import { ClozePreview, parseClozes, uniqueClozeNumbers } from "@/components/ClozePreview";
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

describe("NoteEditor", () => {
  it("renders the Basic tab by default", () => {
    render(<NoteEditor deckId={1} />);
    // The Basic tab is selected, so its panel fields are present in the DOM.
    expect(screen.getByLabelText("Front")).toBeInTheDocument();
    expect(screen.getByLabelText("Back")).toBeInTheDocument();
  });

  it("submitting empty Basic fields shows an error toast and does not call mutate", async () => {
    const user = userEvent.setup();
    render(<NoteEditor deckId={1} />);
    await user.click(getSubmitButton());
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "destructive",
        title: expect.stringMatching(/Champs incomplets/i),
      }),
    );
    expect(mutateMock).not.toHaveBeenCalled();
  });

  it("submits valid Basic note via createNote", async () => {
    const user = userEvent.setup();
    render(<NoteEditor deckId={42} />);
    await user.type(screen.getByLabelText("Front"), "Q?");
    await user.type(screen.getByLabelText("Back"), "A!");
    await user.click(getSubmitButton());
    expect(mutateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        deckId: 42,
        template: "basic",
        fields: { front: "Q?", back: "A!" },
        tags: [],
      }),
    );
  });

  it("adds tags on Enter and removes them via the chip remove button", async () => {
    const user = userEvent.setup();
    render(<NoteEditor deckId={1} />);
    const tagInput = screen.getByLabelText("Tags");
    await user.type(tagInput, "japanese{Enter}");
    expect(screen.getByText("japanese")).toBeInTheDocument();
    await user.type(tagInput, "kanji,");
    expect(screen.getByText("kanji")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Retirer japanese/ }));
    expect(screen.queryByText("japanese")).not.toBeInTheDocument();
  });

  it("switching template resets the basic fields", async () => {
    const user = userEvent.setup();
    render(<NoteEditor deckId={1} />);
    const front = screen.getByLabelText("Front") as HTMLTextAreaElement;
    await user.type(front, "leftover");
    expect(front.value).toBe("leftover");
    await user.click(screen.getByRole("tab", { name: /^Cloze$/ }));
    await user.click(screen.getByRole("tab", { name: /^Basic$/ }));
    const frontAfter = screen.getByLabelText("Front") as HTMLTextAreaElement;
    expect(frontAfter.value).toBe("");
  });

  it("cloze submit refuses when no {{c1::...}} is present", async () => {
    const user = userEvent.setup();
    render(<NoteEditor deckId={1} />);
    await user.click(screen.getByRole("tab", { name: /^Cloze$/ }));
    const textarea = screen.getByLabelText("Texte");
    await user.type(textarea, "no cloze here");
    await user.click(getSubmitButton());
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "destructive",
        title: expect.stringMatching(/Cloze invalide/i),
      }),
    );
    expect(mutateMock).not.toHaveBeenCalled();
  });
});

describe("ClozePreview helpers", () => {
  it("detects multiple unique cloze numbers", () => {
    const text = "Hello {{c1::world}} and {{c2::moon}}! Plus {{c1::again}}.";
    expect(uniqueClozeNumbers(text)).toEqual([1, 2]);
    expect(parseClozes(text)).toHaveLength(3);
  });

  it("renders preview card per unique cloze number", () => {
    const text = "The {{c1::quick}} brown {{c2::fox}}.";
    render(<ClozePreview text={text} />);
    expect(screen.getByText(/2 cartes seront générées/i)).toBeInTheDocument();
    expect(screen.getByText("Card c1")).toBeInTheDocument();
    expect(screen.getByText("Card c2")).toBeInTheDocument();
  });

  it("shows a hint when no cloze tag is present", () => {
    render(<ClozePreview text="plain text" />);
    expect(screen.getByText(/Aucune balise cloze détectée/i)).toBeInTheDocument();
  });
});
