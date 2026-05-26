/**
 * Visual capture pass for Vagues 1-5 new features.
 * - /achievements (gamification grid)
 * - /review-interleaved (multi-deck selector)
 * - Settings with NeuroModes section scrolled into view
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUT = path.resolve(__dirname, "../../screenshots");

test.describe("Vagues 1-5 capture", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  test("achievements page", async ({ page }) => {
    await page.goto("/achievements");
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT, "v1-achievements.png"), fullPage: true });
  });

  test("review-interleaved page", async ({ page }) => {
    await page.goto("/review-interleaved");
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT, "v5-interleaved.png"), fullPage: true });
  });

  test("settings full page (with neuro section)", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByText(/Paramètres/i)).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT, "v3-settings-full.png"), fullPage: true });
  });

  test("home with sidebar (Trophy + Shuffle entries)", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT, "v1-home-sidebar.png"), fullPage: true });
  });
});
