import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Run cleanup after every test to ensure tests are isolated.
afterEach(() => {
  cleanup();
});
