/**
 * Smoke + state-machine tests for `<HandsFreeReview />` (Vague 23).
 *
 * The audio path is jsdom-limited (HTMLMediaElement.play is stubbed in
 * tests/setup.ts and never emits `ended`), so we drive phase transitions by
 * dispatching the `ended` event ourselves and mock the TTS/Whisper hooks.
 *
 * Targets:
 *  - initial render shows the question phase and reads the recto via TTS.
 *  - walking the machine (question → waiting → answer → rating) reveals the
 *    grade buttons, and a grade fires `onSubmit` + advances the card.
 *  - the pure `transcriptToRating` keyword mapper.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CardWithNote } from "@/lib/tauri";

const synthMutate = vi.fn();
const transcribeMutate = vi.fn();
const toastMock = vi.fn();

vi.mock("@/components/ui/use-toast", () => ({
  toast: (...args: unknown[]) => toastMock(...args),
  useToast: () => ({ toasts: [], toast: toastMock, dismiss: vi.fn() }),
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://${p}`,
}));

// Synth mock: record the call and immediately hand back a fake path so the
// component sets the <audio> src (mirrors the real success path) but does NOT
// auto-advance — phase hand-off happens on the `ended` event we dispatch.
vi.mock("@/lib/queries", () => ({
  useSynthesizeAudio: () => ({
    mutate: (vars: unknown, opts?: { onSuccess?: (r: unknown) => void }) => {
      synthMutate(vars);
      opts?.onSuccess?.({ path: "/tmp/fake.mp3", cached: false, size_bytes: 1 });
    },
    isPending: false,
  }),
  useTranscribeVoiceAnswer: () => ({
    mutate: (vars: unknown) => transcribeMutate(vars),
    isPending: false,
  }),
}));

import { HandsFreeReview, transcriptToRating } from "@/components/HandsFreeReview";

function card(id: number, front: string, back: string): CardWithNote {
  return {
    card: {
      id,
      note_id: id,
      deck_id: 1,
      card_ord: 0,
      state: "review",
      due: 0,
      stability: 1,
      difficulty: 5,
      elapsed_days: 0,
      scheduled_days: 1,
      reps: 1,
      lapses: 0,
      last_review: null,
      suspended: false,
      created_at: 0,
      updated_at: 0,
    } as unknown as CardWithNote["card"],
    note: {
      id,
      deck_id: 1,
      template: "basic",
      fields: { front, back },
      tags: [],
      created_at: 0,
      updated_at: 0,
    },
  };
}

/** Fire the <audio> `ended` event so the machine advances phases. */
function endNarration() {
  const audio = document.querySelector("audio");
  if (audio) fireEvent.ended(audio);
}

beforeEach(() => {
  synthMutate.mockReset();
  transcribeMutate.mockReset();
  toastMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("transcriptToRating", () => {
  it("maps spoken keywords (fr + en) to the four grades", () => {
    expect(transcriptToRating("encore")).toBe(1);
    expect(transcriptToRating("c'était difficile")).toBe(2);
    expect(transcriptToRating("bien")).toBe(3);
    expect(transcriptToRating("trop facile")).toBe(4);
    expect(transcriptToRating("good")).toBe(3);
    expect(transcriptToRating("aucune idée")).toBeNull();
  });
});

describe("HandsFreeReview", () => {
  it("renders the question phase and reads the recto via TTS", () => {
    render(
      <HandsFreeReview
        cards={[card(1, "Capitale de la France", "Paris")]}
        onSubmit={vi.fn()}
        onExit={vi.fn()}
        onDone={vi.fn()}
      />,
    );

    // Hands-free shell + per-card counter render.
    expect(screen.getByTestId("hands-free-review")).toBeInTheDocument();
    expect(screen.getByText(/carte 1 \/ 1/i)).toBeInTheDocument();
    // Question phase banner + TTS invoked with the recto text.
    expect(screen.getByText(/Écoute la question/i)).toBeInTheDocument();
    expect(synthMutate).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Capitale de la France" }),
    );
  });

  it("walks the machine and submits a grade, advancing to the next card", () => {
    const onSubmit = vi.fn();
    const onDone = vi.fn();
    render(
      <HandsFreeReview
        cards={[card(1, "Q1", "A1"), card(2, "Q2", "A2")]}
        onSubmit={onSubmit}
        onExit={vi.fn()}
        onDone={onDone}
      />,
    );

    // question → (narration ends) → waiting: the reveal button appears.
    endNarration();
    const reveal = screen.getByRole("button", { name: /Révéler la réponse/i });
    expect(reveal).toBeInTheDocument();

    // waiting → answer: TTS reads the verso.
    fireEvent.click(reveal);
    expect(synthMutate).toHaveBeenCalledWith(expect.objectContaining({ text: "A1" }));

    // answer → (narration ends) → rating: the four grade buttons appear.
    endNarration();
    const good = screen.getByRole("button", { name: "Bien" });
    expect(good).toBeInTheDocument();

    // Grading submits and advances to card 2 (back to the question phase).
    fireEvent.click(good);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(1, 3, expect.any(Number));
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByText(/carte 2 \/ 2/i)).toBeInTheDocument();
    expect(screen.getByText(/Écoute la question/i)).toBeInTheDocument();
  });
});
