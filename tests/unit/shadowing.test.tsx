/**
 * Tests for `<ShadowingPractice />` (Vague 17 — Arguelles shadowing).
 *
 * Coverage:
 *   1. The practice surface renders: the sentence textarea, the Écouter /
 *      Enregistrer controls, and both (reference + user) waveform canvases.
 *      "Écouter" stays disabled until a sentence is typed.
 *   2. `computeWaveformPeaks` down-samples a PCM channel to the requested bar
 *      count and normalises the loudest bar to 1.
 *   3. When synthesis fails, the page degrades to the Web Speech fallback
 *      (« voix système » note, informative toast, no further synth calls)
 *      instead of a dead « Écouter » button.
 *
 * The Web-Audio AudioContext is stubbed globally in `tests/setup.ts`; the TTS
 * query hooks + `convertFileSrc` are mocked here. We never exercise the real
 * MediaRecorder / decode path in these tests.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const synthesizeMutateAsync = vi.fn(async () => ({
  path: "/tmp/x.mp3",
  cached: false,
  size_bytes: 1,
}));
const toastMock = vi.fn();

vi.mock("@/components/ui/use-toast", () => ({
  toast: (...args: unknown[]) => toastMock(...args),
  useToast: () => ({ toasts: [], toast: toastMock, dismiss: vi.fn() }),
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${p}`,
}));

vi.mock("@/lib/queries", () => ({
  useSettingsQuery: () => ({ data: { tts_voice: "nova", tts_speed: 1.0 } }),
  useSynthesizeAudio: () => ({ mutateAsync: synthesizeMutateAsync, isPending: false }),
}));

import { computeWaveformPeaks, ShadowingPractice } from "@/components/ShadowingPractice";

beforeEach(() => {
  synthesizeMutateAsync.mockClear();
  toastMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("computeWaveformPeaks", () => {
  it("down-samples to the requested bar count and normalises the peak to 1", () => {
    // 8 samples → 4 bars: each bar spans 2 samples, taking the max abs value.
    const samples = new Float32Array([0.1, 0.2, -0.5, 0.3, 0.25, 0.1, 0.05, 0.0]);
    const peaks = computeWaveformPeaks(samples, 4);
    expect(peaks).toHaveLength(4);
    // Loudest absolute sample is 0.5 (bar index 1) → normalised to 1.
    expect(Math.max(...peaks)).toBeCloseTo(1, 5);
    expect(peaks[1]).toBeCloseTo(1, 5);
    // Every bar is within [0, 1].
    for (const p of peaks) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });

  it("returns an empty array for empty input or zero bars", () => {
    expect(computeWaveformPeaks(new Float32Array([]), 10)).toEqual([]);
    expect(computeWaveformPeaks(new Float32Array([0.5]), 0)).toEqual([]);
  });
});

describe("ShadowingPractice", () => {
  it("renders the controls and both waveform canvases", () => {
    render(<ShadowingPractice />);
    expect(screen.getByTestId("shadowing-practice")).toBeInTheDocument();
    expect(screen.getByTestId("listen-button")).toBeInTheDocument();
    expect(screen.getByTestId("record-button")).toBeInTheDocument();
    expect(screen.getByTestId("reference-waveform")).toBeInTheDocument();
    expect(screen.getByTestId("user-waveform")).toBeInTheDocument();

    // "Écouter" is disabled until a sentence is entered, then enabled.
    const listen = screen.getByTestId("listen-button");
    expect(listen).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Saisis ou colle une phrase/i), {
      target: { value: "Buenos días" },
    });
    expect(listen).toBeEnabled();
  });

  it("falls back to the system voice when synthesis fails, with a discreet note", async () => {
    synthesizeMutateAsync.mockRejectedValueOnce(new Error("No API key configured"));
    // jsdom ships no Web Speech API — install observable stubs.
    const speakSpy = vi.fn();
    const cancelSpy = vi.fn();
    vi.stubGlobal("speechSynthesis", { speak: speakSpy, cancel: cancelSpy });
    class FakeUtterance {
      text: string;
      rate = 1;
      constructor(text: string) {
        this.text = text;
      }
    }
    vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);

    render(<ShadowingPractice />);
    fireEvent.change(screen.getByLabelText(/Saisis ou colle une phrase/i), {
      target: { value: "Hello world" },
    });
    fireEvent.click(screen.getByTestId("listen-button"));

    // The « voix système » note appears, the sentence is spoken via Web
    // Speech, and the learner is informed (non-destructive toast).
    expect(await screen.findByTestId("fallback-note")).toHaveTextContent("voix système");
    expect(speakSpy).toHaveBeenCalledTimes(1);
    expect((speakSpy.mock.calls[0]?.[0] as { text: string }).text).toBe("Hello world");
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Voix locale utilisée" }),
    );

    // Subsequent listens go straight to Web Speech — no further synth calls.
    synthesizeMutateAsync.mockClear();
    fireEvent.click(screen.getByTestId("listen-button"));
    await waitFor(() => expect(speakSpy).toHaveBeenCalledTimes(2));
    expect(synthesizeMutateAsync).not.toHaveBeenCalled();
  });
});
