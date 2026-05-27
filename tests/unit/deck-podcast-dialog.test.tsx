/**
 * Tests for `<DeckPodcastDialog />` (Vague 8).
 *
 * Smoke + interaction:
 *   - the dialog renders titles, format radios, voice selectors, and an
 *     enabled "Générer" button when host/expert voices differ;
 *   - choosing the same voice for both speakers disables generation and
 *     surfaces a warning hint;
 *   - clicking "Générer" dispatches the mutation with the picked params.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const generateMutate = vi.fn();
const deleteMutate = vi.fn();
const toastMock = vi.fn();

vi.mock("@/components/ui/use-toast", () => ({
  toast: (...args: unknown[]) => toastMock(...args),
  useToast: () => ({ toasts: [], toast: toastMock, dismiss: vi.fn() }),
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://${p}`,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn().mockResolvedValue(null),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  copyFile: vi.fn().mockResolvedValue(undefined),
}));

let listData: Array<{ path: string; generated_at: number; size_bytes: number }> = [];

vi.mock("@/lib/queries", () => ({
  useListDeckPodcasts: () => ({ data: listData, isLoading: false }),
  useGenerateDeckPodcast: () => ({
    mutate: generateMutate,
    isPending: false,
  }),
  useDeletePodcast: () => ({
    mutate: deleteMutate,
    isPending: false,
  }),
}));

import { DeckPodcastDialog } from "@/components/DeckPodcastDialog";

beforeEach(() => {
  generateMutate.mockReset();
  deleteMutate.mockReset();
  toastMock.mockReset();
  listData = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DeckPodcastDialog", () => {
  it("renders the title, three format radios and both voice selectors", () => {
    render(
      <DeckPodcastDialog deckId={42} deckName="Bio 101" open onOpenChange={() => undefined} />,
    );
    expect(screen.getByText(/Générer un podcast/i)).toBeInTheDocument();
    // 3 format radio buttons.
    const radios = screen.getAllByRole("radio");
    expect(radios.length).toBe(3);
    expect(screen.getByLabelText(/Voix Host/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Voix Expert/i)).toBeInTheDocument();
    // Generate button enabled — defaults differ (nova vs onyx).
    const generate = screen.getByRole("button", { name: /Générer le podcast/i });
    expect(generate).not.toBeDisabled();
  });

  it("disables generation and warns when both voices match", () => {
    render(
      <DeckPodcastDialog deckId={42} deckName="Bio 101" open onOpenChange={() => undefined} />,
    );
    const hostSelect = screen.getByLabelText(/Voix Host/i) as HTMLSelectElement;
    // Force expert == host by changing host to "onyx" (the default expert voice).
    fireEvent.change(hostSelect, { target: { value: "onyx" } });
    expect(screen.getByText(/deux voix différentes/i)).toBeInTheDocument();
    const generate = screen.getByRole("button", { name: /Générer le podcast/i });
    expect(generate).toBeDisabled();
  });

  it("dispatches the generate mutation with the picked params", () => {
    render(<DeckPodcastDialog deckId={7} deckName="Bio 101" open onOpenChange={() => undefined} />);
    // Pick the "Brief" format radio (second radio in the rendered grid).
    const radios = screen.getAllByRole("radio");
    const briefRadio = radios.find((r) => r.textContent?.includes("Brief"));
    expect(briefRadio).toBeDefined();
    if (briefRadio) fireEvent.click(briefRadio);
    fireEvent.click(screen.getByRole("button", { name: /Générer le podcast/i }));
    expect(generateMutate).toHaveBeenCalledTimes(1);
    const payload = generateMutate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.deckId).toBe(7);
    expect(payload.format).toBe("brief");
    expect(payload.hostVoice).toBe("nova");
    expect(payload.expertVoice).toBe("onyx");
  });
});
