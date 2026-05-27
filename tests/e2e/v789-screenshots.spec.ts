/**
 * Visual captures for Vagues 7/8/9 + S4-final.
 * Run ad-hoc against `vite --port 1420` (no Tauri needed; invoke errors are
 * filtered). Long timeouts because Three.js + R3F bundle is heavy.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "@playwright/test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUT = path.resolve(__dirname, "../../screenshots");

test.describe.configure({ timeout: 90_000 });

test.describe("Vagues 7-9 + S4 captures", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  test("settings full page", async ({ page }) => {
    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(OUT, "v789-settings-full.png"), fullPage: true });
  });

  test("stats with calibration dashboard", async ({ page }) => {
    await page.goto("/stats", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    await page.screenshot({
      path: path.join(OUT, "v7-stats-calibration.png"),
      fullPage: true,
    });
  });

  test("palaces index page", async ({ page }) => {
    await page.goto("/palaces", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(4000);
    await page.screenshot({ path: path.join(OUT, "v9-palaces-index.png"), fullPage: true });
  });

  test("home dark mode with full sidebar", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      document.documentElement.classList.add("dark");
    });
    await page.waitForTimeout(2500);
    await page.screenshot({
      path: path.join(OUT, "v9-home-dark-full-sidebar.png"),
      fullPage: true,
    });
  });
});
