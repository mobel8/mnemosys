/**
 * Tests for palace management on the Memory Palaces index page
 * (Vague 9 — wiring the existing delete/update backend into the UI).
 *
 * Coverage:
 *   1. Each palace tile renders an action menu exposing « Renommer » and
 *      « Supprimer ».
 *   2. Confirming the delete AlertDialog calls the `useDeletePalace` mutation
 *      with the palace id.
 *   3. The rename dialog opens pre-filled with the current name.
 *
 * The Tauri-backed query/mutation hooks and the router `<Link>` are mocked.
 * Radix DropdownMenu needs the pointer-capture / scrollIntoView stubs (jsdom
 * lacks them) and `userEvent` to open via real pointer events.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Palace } from "@/lib/tauri";

const deleteMutate = vi.fn();
const updateMutate = vi.fn();
const createMutate = vi.fn();
const toastMock = vi.fn();

let palaceRows: Palace[] = [];

vi.mock("@/components/ui/use-toast", () => ({
  toast: (...args: unknown[]) => toastMock(...args),
  useToast: () => ({ toasts: [], toast: toastMock, dismiss: vi.fn() }),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to?: string }) => (
    <a href={to ?? "#"}>{children}</a>
  ),
}));

vi.mock("@/lib/queries", () => ({
  usePalaces: () => ({ data: palaceRows, isLoading: false }),
  useCreatePalace: () => ({ mutate: createMutate, isPending: false }),
  useDeletePalace: () => ({ mutate: deleteMutate, isPending: false }),
  useUpdatePalace: () => ({ mutate: updateMutate, isPending: false }),
}));

import PalacesIndexPage from "@/routes/palaces.page";

const HOUSE: Palace = {
  id: 7,
  name: "Ma maison",
  description: "Parcours test",
  template: "house",
  created_at: 0,
  updated_at: 0,
};

beforeAll(() => {
  // Radix DropdownMenu calls these on the trigger / items; jsdom lacks them.
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => undefined;
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => undefined;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => undefined;
  }
});

beforeEach(() => {
  deleteMutate.mockReset();
  updateMutate.mockReset();
  createMutate.mockReset();
  toastMock.mockReset();
  palaceRows = [HOUSE];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Palaces index — management", () => {
  it("renders an action menu with Renommer and Supprimer per palace", async () => {
    const user = userEvent.setup();
    render(<PalacesIndexPage />);

    // Humanized template label, not the raw "house".
    expect(screen.getByText("Maison")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Actions du palace/i }));

    expect(await screen.findByRole("menuitem", { name: /Renommer/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Supprimer/i })).toBeInTheDocument();
  });

  it("calls useDeletePalace.mutate with the palace id after confirming", async () => {
    const user = userEvent.setup();
    render(<PalacesIndexPage />);

    await user.click(screen.getByRole("button", { name: /Actions du palace/i }));
    await user.click(await screen.findByRole("menuitem", { name: /Supprimer/i }));

    // The AlertDialog confirms the palace name and exposes a destructive action.
    expect(await screen.findByText(/Supprimer « Ma maison » \?/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Supprimer" }));

    await waitFor(() => expect(deleteMutate).toHaveBeenCalledTimes(1));
    expect(deleteMutate.mock.calls[0]?.[0]).toBe(7);
  });

  it("opens the rename dialog pre-filled with the current name", async () => {
    const user = userEvent.setup();
    render(<PalacesIndexPage />);

    await user.click(screen.getByRole("button", { name: /Actions du palace/i }));
    await user.click(await screen.findByRole("menuitem", { name: /Renommer/i }));

    const nameInput = (await screen.findByLabelText("Nom")) as HTMLInputElement;
    expect(nameInput.value).toBe("Ma maison");
  });
});
