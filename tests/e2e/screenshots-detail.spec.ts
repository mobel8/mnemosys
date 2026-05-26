/**
 * Detail screenshots — zoomed snapshots of specific UI pieces that the
 * top-level page captures don't show clearly (settings sections below
 * the fold, AI generator with sample text, dark theme, etc.).
 */

import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUT = path.resolve(__dirname, "../../screenshots");

test.describe("Detail captures", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  test("settings — integrations section (scrolled)", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByText(/Paramètres/i)).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(500);
    // Scroll down to the Intégrations card.
    const integrations = page.getByText(/Intégrations/i).first();
    await integrations.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, "05-settings-integrations.png"), fullPage: false });
  });

  test("settings — import export (scrolled)", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByText(/Paramètres/i)).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(500);
    const data = page.getByRole("heading", { name: /^Données$/ });
    await data.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, "06-settings-import-export.png"), fullPage: false });
  });

  test("dark theme — home", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      document.documentElement.classList.add("dark");
    });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, "07-home-dark.png"), fullPage: true });
  });

  test("ai generator with text typed", async ({ page }) => {
    await page.goto("/ai-generate");
    await expect(page.getByText(/Génération IA/i).first()).toBeVisible({ timeout: 10_000 });
    const textarea = page.locator("textarea").first();
    await textarea.fill(
      "Photosynthesis is the process by which plants convert sunlight into chemical energy. " +
        "Chlorophyll absorbs red and blue light most efficiently. " +
        "The Calvin cycle fixes CO2 into glucose. " +
        "Mitochondria produce ATP through oxidative phosphorylation.",
    );
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, "08-ai-generator-filled.png"), fullPage: true });
  });
});
