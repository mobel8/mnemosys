/**
 * Smoke + interaction tests for `<TtsButton />`.
 *
 * The audio playback path is jsdom-impossible (no Web Audio), so we only
 * exercise the render states and the mutation wiring:
 *   - renders disabled on empty text
 *   - issues the synthesise mutation on click with the resolved voice/speed
 *   - falls back to "nova" / 1.0 when settings haven't loaded
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const synthMutate = vi.fn();
const toastMock = vi.fn();

vi.mock("@/components/ui/use-toast", () => ({
  toast: (...args: unknown[]) => toastMock(...args),
  useToast: () => ({ toasts: [], toast: toastMock, dismiss: vi.fn() }),
}));

// `convertFileSrc` is a Tauri-injected helper. Returning the path verbatim
// keeps the assertions deterministic.
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://${p}`,
}));

// We control what `useSettingsQuery` returns per-test by mutating this var
// before `render()`. Default = no settings loaded yet.
let settingsData: { tts_voice: string | null; tts_speed: number | null } | undefined;

vi.mock("@/lib/queries", () => ({
  useSettingsQuery: () => ({ data: settingsData, isLoading: false }),
  useSynthesizeAudio: () => ({
    mutate: (vars: unknown, opts?: { onSuccess?: (r: unknown) => void }) => {
      synthMutate(vars);
      // jsdom never finishes the `<audio>` play — we just simulate the
      // backend handing back a path so the cache layer engages.
      opts?.onSuccess?.({ path: "/tmp/fake.mp3", cached: false, size_bytes: 1024 });
    },
    isPending: false,
  }),
}));

import { TtsButton } from "@/components/TtsButton";

beforeEach(() => {
  synthMutate.mockReset();
  toastMock.mockReset();
  settingsData = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TtsButton", () => {
  it("renders disabled when text is empty", () => {
    render(<TtsButton text="" />);
    const btn = screen.getByRole("button", { name: /lire/i });
    expect(btn).toBeDisabled();
  });

  it("renders enabled when text is non-empty", () => {
    render(<TtsButton text="Hello world" />);
    const btn = screen.getByRole("button", { name: /lire/i });
    expect(btn).not.toBeDisabled();
  });

  it("calls the synthesise mutation with default voice/speed when settings absent", () => {
    render(<TtsButton text="Bonjour" />);
    fireEvent.click(screen.getByRole("button", { name: /lire/i }));
    expect(synthMutate).toHaveBeenCalledTimes(1);
    expect(synthMutate).toHaveBeenCalledWith({
      text: "Bonjour",
      voice: "nova",
      speed: 1.0,
    });
  });

  it("uses the voice/speed from the user's settings", () => {
    settingsData = { tts_voice: "echo", tts_speed: 1.5 };
    render(<TtsButton text="Bonjour" />);
    fireEvent.click(screen.getByRole("button", { name: /lire/i }));
    expect(synthMutate).toHaveBeenCalledWith({
      text: "Bonjour",
      voice: "echo",
      speed: 1.5,
    });
  });

  it("honours an explicit voice prop over the user setting", () => {
    settingsData = { tts_voice: "echo", tts_speed: 1.5 };
    render(<TtsButton text="Bonjour" voice="onyx" />);
    fireEvent.click(screen.getByRole("button", { name: /lire/i }));
    expect(synthMutate).toHaveBeenCalledWith({
      text: "Bonjour",
      voice: "onyx",
      speed: 1.5,
    });
  });
});
