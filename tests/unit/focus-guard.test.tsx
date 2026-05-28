/**
 * Tests for `<FocusGuard />` (Vague 12 — WebGazer mind-wandering detection).
 *
 * The real WebGazer bundle (TFJS + mediapipe) can't run under jsdom, so we
 * mock the module defensively. The two cases below both take the no-op path,
 * so the dynamic `import("webgazer")` never actually fires — we assert the
 * guard renders nothing and never touches the camera:
 *   - no `navigator.mediaDevices` (jsdom default) → renders nothing;
 *   - `enabled = false` → renders nothing regardless of camera support.
 */

import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const beginMock = vi.fn();
const endMock = vi.fn();

// Defensive mock so the heavy real lib is never pulled into jsdom even if a
// future change reaches the active path during a test run.
vi.mock("webgazer", () => {
  const wg = {
    setGazeListener: vi.fn(() => wg),
    clearGazeListener: vi.fn(() => wg),
    showVideo: vi.fn(() => wg),
    showFaceOverlay: vi.fn(() => wg),
    showFaceFeedbackBox: vi.fn(() => wg),
    showPredictionPoints: vi.fn(() => wg),
    begin: (...a: unknown[]) => {
      beginMock(...a);
      return Promise.resolve();
    },
    end: () => endMock(),
  };
  return { default: wg };
});

import { FocusGuard } from "@/components/FocusGuard";

afterEach(() => {
  vi.clearAllMocks();
  // Reset any navigator stub between tests.
  // biome-ignore lint/suspicious/noExplicitAny: minimal global cleanup.
  (globalThis.navigator as any).mediaDevices = undefined;
});

describe("FocusGuard", () => {
  it("renders nothing and never starts WebGazer when mediaDevices is absent", () => {
    // jsdom has no navigator.mediaDevices by default.
    const { container } = render(<FocusGuard enabled />);
    expect(container).toBeEmptyDOMElement();
    expect(beginMock).not.toHaveBeenCalled();
  });

  it("renders nothing when the feature toggle is off (even with a camera)", () => {
    // Pretend a camera exists; the toggle being off must still no-op.
    // biome-ignore lint/suspicious/noExplicitAny: minimal navigator stub.
    (globalThis.navigator as any).mediaDevices = { getUserMedia: vi.fn() };
    const { container } = render(<FocusGuard enabled={false} />);
    expect(container).toBeEmptyDOMElement();
    expect(beginMock).not.toHaveBeenCalled();
  });
});
