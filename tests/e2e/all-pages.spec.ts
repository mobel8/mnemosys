/**
 * Full page-by-page capture + console harvest for the audit.
 * Captures every route (light + dark) and records any unexpected console
 * error so we can eyeball structure/proportions and catch runtime crashes.
 *
 * Runs against bare Vite (no Tauri) — invoke errors are filtered.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { type ConsoleMessage, type Page, test } from "@playwright/test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUT = path.resolve(__dirname, "../../screenshots/audit");

test.describe.configure({ timeout: 60_000 });

const IGNORE = [
  /Cannot read properties of undefined \(reading 'invoke'\)/,
  /window\.__TAURI_INTERNALS__/,
  /Not implemented: window\.scrollTo/,
  /The width\(-1\) and height\(-1\) of chart/,
  /A param matched/,
];
const ignore = (t: string) => IGNORE.some((re) => re.test(t));

const ROUTES: { path: string; name: string }[] = [
  { path: "/", name: "01-home" },
  { path: "/stats", name: "02-stats" },
  { path: "/settings", name: "03-settings" },
  { path: "/ai-generate", name: "04-ai-generate" },
  { path: "/achievements", name: "05-achievements" },
  { path: "/review-interleaved", name: "06-interleaved" },
  { path: "/palaces", name: "07-palaces" },
  { path: "/graph", name: "08-graph" },
  { path: "/music", name: "09-music" },
  { path: "/gesture", name: "10-gesture" },
  { path: "/shadowing", name: "11-shadowing" },
  { path: "/reading", name: "12-reading" },
  { path: "/planner", name: "13-planner" },
  { path: "/mnemonics", name: "14-mnemonics" },
  { path: "/decks/1", name: "15-deck-detail" },
  { path: "/decks/1/new-card", name: "16-new-card" },
];

function harvest(page: Page, sink: string[], route: string) {
  page.on("console", (m: ConsoleMessage) => {
    if (m.type() === "error" && !ignore(m.text())) sink.push(`[${route}] ${m.text()}`);
  });
  page.on("pageerror", (e) => {
    if (!ignore(e.message)) sink.push(`[${route}] pageerror: ${e.message}`);
  });
}

for (const r of ROUTES) {
  test(`capture ${r.path}`, async ({ page }) => {
    const errors: string[] = [];
    harvest(page, errors, r.path);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(r.path, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1800);
    await page.screenshot({ path: path.join(OUT, `${r.name}-light.png`), fullPage: true });
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, `${r.name}-dark.png`), fullPage: true });
    if (errors.length > 0) {
      console.log(`\n!!! ${r.path} console errors:`);
      for (const e of errors) console.log(e);
    }
  });
}
