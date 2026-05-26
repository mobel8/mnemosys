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

// Run cleanup after every test to ensure tests are isolated.
afterEach(() => {
  cleanup();
});
