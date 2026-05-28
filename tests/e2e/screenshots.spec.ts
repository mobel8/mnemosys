/**
 * Visual capture pass — navigates every top-level route and writes a PNG
 * for documentation. Intended to be ran ad-hoc (`pnpm playwright test
 * tests/e2e/screenshots.spec.ts`) rather than in CI.
 *
 * Tauri-only IPC commands (invoke) fail under a plain Vite dev server,
 * which is fine for screenshots: empty/error states are still part of
 * the UI we want to document. We hide the auto-injected toast container
 * for cleaner shots.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUT = path.resolve(__dirname, "../../screenshots");

test.describe("Mnemosys UI capture", () => {
  test.beforeEach(async ({ page }) => {
    // Force a deterministic viewport so the screenshots stay diff-friendly.
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  test("home", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(/Mnemosys/i).first()).toBeVisible({ timeout: 10_000 });
    // Let suspense + framer-motion settle.
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT, "01-home.png"), fullPage: true });
  });

  test("stats", async ({ page }) => {
    await page.goto("/stats");
    await expect(page.locator("h1, h2, h3").first()).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT, "02-stats.png"), fullPage: true });
  });

  test("settings", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Paramètres" })).toBeVisible({
      timeout: 10_000,
    });
    // Scroll through to capture every section.
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT, "03-settings.png"), fullPage: true });
  });

  test("ai-generate", async ({ page }) => {
    await page.goto("/ai-generate");
    await expect(page.getByText(/Génération IA|AI|Générer/i).first()).toBeVisible({
      timeout: 10_000,
    });
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT, "04-ai-generate.png"), fullPage: true });
  });
});
