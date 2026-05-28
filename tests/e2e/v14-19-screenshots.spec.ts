/**
 * Visual captures for Vagues 14-19 new routes/modes.
 * Ad-hoc against `vite --port 1420`.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "@playwright/test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUT = path.resolve(__dirname, "../../screenshots");

test.describe.configure({ timeout: 60_000 });

const ROUTES: { path: string; name: string }[] = [
  { path: "/music", name: "v16-music" },
  { path: "/gesture", name: "v16-gesture" },
  { path: "/reading", name: "v17-reading" },
  { path: "/shadowing", name: "v17-shadowing" },
];

test.describe("Vagues 14-19 captures", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  for (const r of ROUTES) {
    test(`route ${r.path}`, async ({ page }) => {
      await page.goto(r.path, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1500);
      await page.screenshot({ path: path.join(OUT, `${r.name}.png`), fullPage: true });
    });
  }

  test("new-card editor with all template tabs", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(OUT, "v14-19-home.png"), fullPage: true });
  });
});
