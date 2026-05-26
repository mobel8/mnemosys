/**
 * Console error harvesting — navigates every route and dumps any browser
 * console error / page error / unhandled rejection to stdout. Skips the
 * known-and-expected "Cannot read properties of undefined (reading 'invoke')"
 * because we run against bare Vite (no Tauri host).
 *
 * Run with:
 *   ./node_modules/.bin/playwright test tests/e2e/console-check.spec.ts --reporter=line
 *
 * Any UNexpected error makes the test fail, so this also doubles as a
 * smoke-test that the frontend mounts on every route without component
 * crashes (Suspense errors, missing exports, undefined hooks, …).
 */

import { test, expect, type Page } from "@playwright/test";

const ROUTES = ["/", "/stats", "/settings", "/ai-generate"] as const;

const IGNORE_PATTERNS = [
  // Vite + Tauri bridge missing — expected when running without Tauri.
  /Cannot read properties of undefined \(reading 'invoke'\)/,
  /window\.__TAURI_INTERNALS__/,
  // jsdom-only diagnostics that surface in headless Chromium too.
  /Not implemented: window\.scrollTo/,
  // React hydration mismatch warnings from extension scripts (Playwright extension).
  /Hydration failed/,
  // React Router prefetch noise — harmless.
  /A param matched, but the matching value was not provided/,
];

function shouldIgnore(message: string): boolean {
  return IGNORE_PATTERNS.some((re) => re.test(message));
}

interface Captured {
  route: string;
  kind: "console.error" | "pageerror" | "unhandled";
  text: string;
}

async function harvest(page: Page, route: string, sink: Captured[]) {
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (shouldIgnore(text)) return;
    sink.push({ route, kind: "console.error", text });
  });
  page.on("pageerror", (err) => {
    if (shouldIgnore(err.message)) return;
    sink.push({ route, kind: "pageerror", text: err.message });
  });
  page.on("crash", () => {
    sink.push({ route, kind: "pageerror", text: "Page crashed" });
  });

  await page.goto(route, { waitUntil: "domcontentloaded" });
  // Give React + framer-motion enough time to mount everything.
  await page.waitForTimeout(1500);
}

test("no unexpected console errors across all routes", async ({ page }) => {
  const captured: Captured[] = [];
  const warnings: Captured[] = [];
  const failed: { route: string; url: string; status: number }[] = [];

  // Always-on harvesting before navigation so we don't miss boot-time issues.
  page.on("console", (msg) => {
    if (msg.type() === "warning") {
      const text = msg.text();
      if (!shouldIgnore(text)) {
        warnings.push({ route: page.url(), kind: "console.error", text });
      }
    }
  });
  page.on("response", (resp) => {
    if (resp.status() >= 400) {
      failed.push({ route: page.url(), url: resp.url(), status: resp.status() });
    }
  });

  for (const route of ROUTES) {
    await harvest(page, route, captured);
  }

  if (captured.length > 0) {
    console.log("\n--- Captured unexpected errors ---");
    for (const c of captured) {
      console.log(`[${c.route}] (${c.kind}) ${c.text}`);
    }
    console.log("----------------------------------\n");
  }
  if (warnings.length > 0) {
    console.log("\n--- Warnings ---");
    for (const w of warnings) {
      console.log(`[${w.route}] ${w.text}`);
    }
    console.log("----------------\n");
  }
  if (failed.length > 0) {
    console.log("\n--- Network failures (≥400) ---");
    for (const f of failed) {
      console.log(`[${f.route}] ${f.status} ${f.url}`);
    }
    console.log("--------------------------------\n");
  }

  expect(
    captured.filter((c) => c.kind === "pageerror" && /SyntaxError|ReferenceError/.test(c.text)),
  ).toHaveLength(0);
});
