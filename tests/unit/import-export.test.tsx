/**
 * Unit tests for the `<ImportExportSection />` component (C2).
 *
 * The component talks to two off-process APIs we have to stub:
 *   - `@tauri-apps/plugin-dialog` (native save/open dialogs)
 *   - `@/lib/queries` (TanStack Query mutations)
 *
 * We don't spin up the full QueryClient — instead `useDecks`,
 * `useExportJson` and `useImportJson` are replaced with synchronous mocks
 * so each interaction can be observed in isolation.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---- Mocks ----------------------------------------------------------------

const saveMock = vi.fn();
const openMock = vi.fn();
const exportMutate = vi.fn();
const importMutate = vi.fn();
const toastMock = vi.fn();

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: (...args: unknown[]) => saveMock(...args),
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
  useExportJson: () => ({
    mutateAsync: (vars: { deckIds: number[]; path: string }) => {
      exportMutate(vars);
      return Promise.resolve(vars.deckIds.length * 5);
    },
    isPending: false,
  }),
  useImportJson: () => ({
    mutateAsync: (vars: { path: string }) => {
      importMutate(vars);
      return Promise.resolve({
        decks_imported: 2,
        notes_imported: 7,
        cards_created: 9,
        skipped_decks: ["Existing"],
      });
    },
    isPending: false,
  }),
  // Added when the .apkg import landed in Session 2. The existing JSON
  // round-trip tests don't exercise this path, so a no-op mock is enough.
  useImportApkg: () => ({
    mutateAsync: () =>
      Promise.resolve({
        stats: {
          decks_imported: 0,
          notes_imported: 0,
          notes_skipped: 0,
          cards_skipped_no_anki_card: 0,
        },
        skipped_decks: [],
      }),
    isPending: false,
  }),
}));

import { ImportExportSection } from "@/components/settings/ImportExportSection";

beforeEach(() => {
  saveMock.mockReset();
  openMock.mockReset();
  exportMutate.mockReset();
  importMutate.mockReset();
  toastMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ImportExportSection", () => {
  it("renders both Export and Import sub-sections", () => {
    render(<ImportExportSection />);
    expect(screen.getByText("Données")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^Exporter$/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^Importer$/ })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Importer un fichier Mnemosys/i }),
    ).toBeInTheDocument();
  });

  it("disables 'Exporter la sélection' until a deck is checked", async () => {
    const user = userEvent.setup();
    render(<ImportExportSection />);
    const exportBtn = screen.getByRole("button", { name: /Exporter la sélection/i });
    expect(exportBtn).toBeDisabled();

    await user.click(screen.getByLabelText("Spanish"));
    expect(exportBtn).toBeEnabled();
  });

  it("calls save() and the export mutation with the selected deck ids", async () => {
    saveMock.mockResolvedValue("/tmp/mnemosys-export-2026-05-26.json");
    const user = userEvent.setup();
    render(<ImportExportSection />);

    await user.click(screen.getByLabelText("Spanish"));
    await user.click(screen.getByRole("button", { name: /Exporter la sélection/i }));

    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(exportMutate).toHaveBeenCalledWith({
      deckIds: [1],
      path: "/tmp/mnemosys-export-2026-05-26.json",
    });
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: "Export réussi" }));
  });

  it("'Tout exporter' sends every deck id without requiring a selection", async () => {
    saveMock.mockResolvedValue("/tmp/all.json");
    const user = userEvent.setup();
    render(<ImportExportSection />);

    await user.click(screen.getByRole("button", { name: /^Tout exporter$/ }));
    expect(exportMutate).toHaveBeenCalledWith({
      deckIds: [1, 2],
      path: "/tmp/all.json",
    });
  });

  it("skips the export mutation when the user cancels the save dialog", async () => {
    saveMock.mockResolvedValue(null);
    const user = userEvent.setup();
    render(<ImportExportSection />);

    await user.click(screen.getByLabelText("Spanish"));
    await user.click(screen.getByRole("button", { name: /Exporter la sélection/i }));

    expect(saveMock).toHaveBeenCalled();
    expect(exportMutate).not.toHaveBeenCalled();
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("calls open() and the import mutation, surfacing skipped decks in the toast", async () => {
    openMock.mockResolvedValue("/tmp/exchange.json");
    const user = userEvent.setup();
    render(<ImportExportSection />);

    await user.click(screen.getByRole("button", { name: /Importer un fichier Mnemosys/i }));

    expect(openMock).toHaveBeenCalledTimes(1);
    expect(importMutate).toHaveBeenCalledWith({ path: "/tmp/exchange.json" });
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Import terminé",
        description: expect.stringMatching(/Existing/),
      }),
    );
  });

  it("'Tout sélectionner' toggles every checkbox", async () => {
    const user = userEvent.setup();
    render(<ImportExportSection />);
    const spanish = screen.getByLabelText("Spanish") as HTMLInputElement;
    const french = screen.getByLabelText("French") as HTMLInputElement;
    expect(spanish.checked).toBe(false);
    expect(french.checked).toBe(false);

    await user.click(screen.getByRole("button", { name: /Tout sélectionner/i }));
    expect(spanish.checked).toBe(true);
    expect(french.checked).toBe(true);

    await user.click(screen.getByRole("button", { name: /Tout désélectionner/i }));
    expect(spanish.checked).toBe(false);
    expect(french.checked).toBe(false);
  });
});
