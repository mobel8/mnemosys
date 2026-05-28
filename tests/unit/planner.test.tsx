/**
 * Tests for the Study Planner page (Vague 21 — Implementation Intentions).
 *
 * Coverage:
 *   1. The Gollwitzer rationale + the « si X alors Y » form render.
 *   2. Submitting the form calls `createPlan` with the typed trigger/action
 *      and a JSON-encoded `days` array reflecting the selected weekdays.
 *   3. Toggling a plan's Switch calls `togglePlan` with the new enabled state.
 *
 * The Tauri-backed query/mutation hooks are mocked; we assert on the call
 * arguments rather than any real IPC.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StudyPlan } from "@/lib/tauri";

const createMutate = vi.fn();
const updateMutate = vi.fn();
const toggleMutate = vi.fn();
const deleteMutate = vi.fn();
const toastMock = vi.fn();

let planRows: StudyPlan[] = [];

vi.mock("@/components/ui/use-toast", () => ({
  toast: (...args: unknown[]) => toastMock(...args),
  useToast: () => ({ toasts: [], toast: toastMock, dismiss: vi.fn() }),
}));

vi.mock("@/lib/queries", () => ({
  usePlans: () => ({ data: planRows, isLoading: false }),
  useDecks: () => ({
    data: [
      {
        id: 3,
        name: "Espagnol",
        color: "#3b82f6",
        description: null,
        desired_retention: 0.9,
        scheduler_kind: "fsrs6",
        created_at: 0,
        updated_at: 0,
      },
    ],
    isLoading: false,
  }),
  useCreatePlan: () => ({ mutate: createMutate, isPending: false }),
  useUpdatePlan: () => ({ mutate: updateMutate, isPending: false }),
  useTogglePlan: () => ({ mutate: toggleMutate, isPending: false }),
  useDeletePlan: () => ({ mutate: deleteMutate, isPending: false }),
}));

import PlannerPage from "@/routes/planner.page";

beforeEach(() => {
  createMutate.mockReset();
  updateMutate.mockReset();
  toggleMutate.mockReset();
  deleteMutate.mockReset();
  toastMock.mockReset();
  planRows = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PlannerPage", () => {
  it("renders the Gollwitzer rationale and the intention form", () => {
    render(<PlannerPage />);
    expect(screen.getByText(/Gollwitzer 1999/i)).toBeInTheDocument();
    expect(screen.getByText(/doublent la probabilité/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Type de déclencheur/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Ajouter l'intention/i })).toBeInTheDocument();
  });

  it("submits a plan with action and JSON-encoded selected days", () => {
    render(<PlannerPage />);

    // Fill the action (trigger defaults to time / 19:00).
    fireEvent.change(screen.getByLabelText(/alors j'étudie/i), {
      target: { value: "Réviser Espagnol 15 min" },
    });
    // Select Monday (ISO 1) and Wednesday (ISO 3) via their aria labels.
    fireEvent.click(screen.getByRole("button", { name: "Jour 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Jour 3" }));

    fireEvent.click(screen.getByRole("button", { name: /Ajouter l'intention/i }));

    expect(createMutate).toHaveBeenCalledTimes(1);
    const payload = createMutate.mock.calls[0]?.[0];
    expect(payload).toMatchObject({
      triggerType: "time",
      triggerValue: "19:00",
      action: "Réviser Espagnol 15 min",
      enabled: true,
    });
    // Days are JSON-encoded ISO weekdays in click order.
    expect(JSON.parse(payload.days).sort()).toEqual([1, 3]);
  });

  it("toggles an existing plan's enabled flag", () => {
    planRows = [
      {
        id: 7,
        trigger_type: "time",
        trigger_value: "19:00",
        action: "Réviser Espagnol",
        deck_id: 3,
        days: "[]",
        enabled: true,
        created_at: 0,
      },
    ];
    render(<PlannerPage />);

    // The plan renders with a Switch (labelled "Désactiver" while enabled).
    const sw = screen.getByRole("switch", { name: /Désactiver/i });
    fireEvent.click(sw);

    expect(toggleMutate).toHaveBeenCalledTimes(1);
    expect(toggleMutate.mock.calls[0]?.[0]).toMatchObject({ id: 7, enabled: false });
  });

  it("pre-fills the form on « Modifier » and calls useUpdatePlan on save", () => {
    planRows = [
      {
        id: 9,
        trigger_type: "time",
        trigger_value: "08:30",
        action: "Réviser le vocabulaire",
        deck_id: 3,
        days: "[2,4]",
        enabled: true,
        created_at: 0,
      },
    ];
    render(<PlannerPage />);

    // Enter edit mode for the existing plan.
    fireEvent.click(screen.getByRole("button", { name: "Modifier" }));

    // The form heading and action input reflect the plan being edited.
    expect(screen.getByText(/Modifier l'intention/i)).toBeInTheDocument();
    const actionInput = screen.getByLabelText(/alors j'étudie/i) as HTMLInputElement;
    expect(actionInput.value).toBe("Réviser le vocabulaire");

    // Tweak the action and save.
    fireEvent.change(actionInput, { target: { value: "Réviser 20 min" } });
    fireEvent.click(screen.getByRole("button", { name: /Enregistrer les modifications/i }));

    expect(updateMutate).toHaveBeenCalledTimes(1);
    const payload = updateMutate.mock.calls[0]?.[0];
    expect(payload).toMatchObject({
      id: 9,
      triggerType: "time",
      triggerValue: "08:30",
      action: "Réviser 20 min",
      enabled: true,
    });
    // Pre-filled weekdays are preserved as a JSON array.
    expect(JSON.parse(payload.days).sort()).toEqual([2, 4]);
  });
});
