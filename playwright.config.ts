import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for Mnemosys.
 * E2E tests live in `tests/e2e/`.
 * For Tauri E2E we will plug in tauri-driver later; for now this targets the
 * Vite dev server so the frontend can be exercised in isolation.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["html", { open: "never" }], ["list"]],
  use: {
    baseURL: "http://localhost:1420",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // Auto-start the Vite dev server so `playwright test` works in one shot.
  // We invoke vite directly (not via pnpm) to skip the package manager
  // overhead — cuts cold-start by ~5s on slower runners.
  webServer: {
    command: "./node_modules/.bin/vite --port 1420",
    url: "http://localhost:1420",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
