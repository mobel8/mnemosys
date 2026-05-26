/**
 * Responsive + dark mode smoke.
 * Catches CSS regressions on narrow viewports or under the dark variant.
 */

import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUT = path.resolve(__dirname, "../../screenshots");

const ROUTES = ["/", "/stats", "/settings", "/ai-generate"] as const;

test.describe("Responsive + dark mode", () => {
  for (const route of ROUTES) {
    const slug = route === "/" ? "home" : route.slice(1).replace(/\//g, "_");

    test(`narrow viewport (480px) ${route}`, async ({ page }) => {
      await page.setViewportSize({ width: 480, height: 800 });
      await page.goto(route);
      await page.waitForTimeout(700);
      // App must mount and at least show *something*.
      await expect(page.locator("body")).toBeVisible();
      await page.screenshot({
        path: path.join(OUT, `narrow-${slug}.png`),
        fullPage: true,
      });
    });

    test(`dark mode ${route}`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.emulateMedia({ colorScheme: "dark" });
      await page.goto(route);
      await page.evaluate(() => {
        document.documentElement.classList.add("dark");
      });
      await page.waitForTimeout(700);
      await expect(page.locator("body")).toBeVisible();
      await page.screenshot({
        path: path.join(OUT, `dark-${slug}.png`),
        fullPage: true,
      });
    });
  }
});
