/**
 * Minimal frontend smoke test.
 *
 * Loads the Vite dev server (started automatically via `webServer` in
 * `playwright.config.ts`) and asserts the app shell renders the "Mnemosys"
 * brand text. This is enough to catch a totally broken build, missing
 * route, or runtime exception during initial mount.
 *
 * Tauri-driver-based E2E (real `tauri dev` window + IPC) is planned for a
 * later session; this test deliberately runs against the browser-mode
 * frontend only, so it stays fast and works in any headless CI runner.
 */

import { expect, test } from "@playwright/test";

test("frontend renders the welcome screen", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/Mnemosys/i).first()).toBeVisible();
});
