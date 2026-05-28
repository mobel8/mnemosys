/**
 * Unit tests for the subtitle-import sub-section of `<ImportExportSection />`
 * (Vague 11).
 *
 * Same stubbing strategy as `import-export.test.tsx`: the native dialog and
 * the `@/lib/queries` mutations are mocked so we can assert the wiring
 * (deck + mode passed to `importSubtitles`, toast recap) without a backend.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const openMock = vi.fn();
const importSubsMutate = vi.fn();
const toastMock = vi.fn();

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn(),
  open: (...args: unknown[]) => openMock(...args),
}));

vi.mock("@/components/ui/use-toast", () => ({
  toast: (...args: unknown[]) => toastMock(...args),
  useToast: () => ({ toasts: [], toast: toastMock, dismiss: vi.fn() }),
}));

vi.mock("@/lib/queries", () => ({
  useDecks: () => ({
    data: [
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
        name: "French",
        color: "#ef4444",
        description: null,
        desired_retention: 0.9,
        scheduler_kind: "fsrs6",
        created_at: 0,
        updated_at: 0,
      },
    ],
    isLoading: false,
  }),
  useExportJson: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useImportJson: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useImportApkg: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useImportSubtitles: () => ({
    mutateAsync: (vars: { path: string; deckId: number; mode: string }) => {
      importSubsMutate(vars);
      return Promise.resolve({ cues_parsed: 12, notes_created: 10, skipped_empty: 2 });
    },
    isPending: false,
  }),
}));

import { ImportExportSection } from "@/components/settings/ImportExportSection";

beforeEach(() => {
  openMock.mockReset();
  importSubsMutate.mockReset();
  toastMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ImportExportSection — subtitle import", () => {
  it("renders the subtitle sub-section with deck + mode selectors", () => {
    render(<ImportExportSection />);
    expect(
      screen.getByRole("heading", { name: /Sous-titres \(sentence mining\)/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Importer des sous-titres/i })).toBeInTheDocument();
    // The mode dropdown offers both sentence + cloze options.
    expect(screen.getByRole("option", { name: /Phrase basique/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Cloze auto/i })).toBeInTheDocument();
  });

  it("imports the picked file into the chosen deck + mode and toasts the recap", async () => {
    openMock.mockResolvedValue("/tmp/movie.srt");
    const user = userEvent.setup();
    render(<ImportExportSection />);

    // Switch the target deck to French (id 2) and the mode to cloze.
    await user.selectOptions(screen.getByLabelText(/Deck cible/i), "2");
    await user.selectOptions(screen.getByLabelText(/^Mode$/i), "cloze");
    await user.click(screen.getByRole("button", { name: /Importer des sous-titres/i }));

    expect(openMock).toHaveBeenCalledTimes(1);
    expect(importSubsMutate).toHaveBeenCalledWith({
      path: "/tmp/movie.srt",
      deckId: 2,
      mode: "cloze",
    });
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Sous-titres importés",
        description: expect.stringMatching(/12 répliques → 10 cartes \(2 ignorées\)/),
      }),
    );
  });

  it("does not import when the user cancels the file dialog", async () => {
    openMock.mockResolvedValue(null);
    const user = userEvent.setup();
    render(<ImportExportSection />);

    await user.click(screen.getByRole("button", { name: /Importer des sous-titres/i }));
    expect(openMock).toHaveBeenCalledTimes(1);
    expect(importSubsMutate).not.toHaveBeenCalled();
    expect(toastMock).not.toHaveBeenCalled();
  });
});
