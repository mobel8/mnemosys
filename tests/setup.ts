import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom doesn't ship a `ResizeObserver` polyfill, but Radix UI components
// (e.g. Slider, Dialog) hit it the moment they mount. Stub it out with a
// no-op so component tests can render the same trees we ship to the user.
if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverStub {
    observe() {
      /* no-op */
    }
    unobserve() {
      /* no-op */
    }
    disconnect() {
      /* no-op */
    }
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}

// jsdom ships no Web Audio API, but the Vague 16 creative tools (metronome,
// ear training, gesture timer) create an `AudioContext` and oscillator/gain
// nodes the moment the user starts them. Provide a minimal no-op stub so those
// components render and toggle without throwing during component tests.
if (typeof globalThis.AudioContext === "undefined") {
  class FakeAudioParam {
    value = 0;
    setValueAtTime() {
      /* no-op */
    }
    exponentialRampToValueAtTime() {
      /* no-op */
    }
  }
  class FakeAudioNode {
    connect(target: unknown) {
      return target;
    }
    disconnect() {
      /* no-op */
    }
  }
  class FakeOscillator extends FakeAudioNode {
    type = "sine";
    frequency = new FakeAudioParam();
    start() {
      /* no-op */
    }
    stop() {
      /* no-op */
    }
  }
  class FakeGain extends FakeAudioNode {
    gain = new FakeAudioParam();
  }
  class FakeAudioContext {
    state: AudioContextState = "running";
    currentTime = 0;
    destination = new FakeAudioNode();
    createOscillator() {
      return new FakeOscillator();
    }
    createGain() {
      return new FakeGain();
    }
    resume() {
      return Promise.resolve();
    }
    close() {
      this.state = "closed";
      return Promise.resolve();
    }
  }
  globalThis.AudioContext = FakeAudioContext as unknown as typeof AudioContext;
}

// jsdom does not implement `HTMLMediaElement.prototype.play` / `.pause`: the
// real impl throws "Not implemented", and `<TtsButton>` does
// `audio.play().catch(...)`. Without a stub `play()` returns undefined (so the
// `.catch` throws) or jsdom emits an *unhandled* promise rejection that leaks
// across the parallel test run and makes `tts-button.test.tsx` flaky. Return a
// resolved Promise so the `.catch` chain is well-formed and never rejects.
Object.defineProperty(globalThis.HTMLMediaElement.prototype, "play", {
  configurable: true,
  writable: true,
  value: () => Promise.resolve(),
});
Object.defineProperty(globalThis.HTMLMediaElement.prototype, "pause", {
  configurable: true,
  writable: true,
  value: () => {
    /* no-op */
  },
});

// Run cleanup after every test to ensure tests are isolated.
afterEach(() => {
  cleanup();
});
