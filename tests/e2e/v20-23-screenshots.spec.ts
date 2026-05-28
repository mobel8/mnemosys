/** Visual captures for Vagues 20-23. Ad-hoc against vite --port 1420. */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "@playwright/test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUT = path.resolve(__dirname, "../../screenshots");

test.describe.configure({ timeout: 60_000 });

const ROUTES = [
  { path: "/planner", name: "v21-planner" },
  { path: "/mnemonics", name: "v21-mnemonics" },
  { path: "/stats", name: "v20-23-stats" },
];

test.describe("Vagues 20-23 captures", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
  });
  for (const r of ROUTES) {
    test(`route ${r.path}`, async ({ page }) => {
      await page.goto(r.path, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2000);
      await page.screenshot({ path: path.join(OUT, `${r.name}.png`), fullPage: true });
    });
  }
});
