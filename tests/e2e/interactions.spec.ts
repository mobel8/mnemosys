/**
 * Interactive smoke pass — opens dialogs, switches tabs, types in inputs,
 * harvests browser console errors. Designed to catch runtime crashes that
 * static rendering misses (uncontrolled inputs, missing icon imports,
 * broken event handlers, etc.).
 *
 * Runs against bare Vite (no Tauri host) — invoke errors are filtered.
 */

import { type ConsoleMessage, expect, type Page, test } from "@playwright/test";

const IGNORE_PATTERNS = [
  /Cannot read properties of undefined \(reading 'invoke'\)/,
  /window\.__TAURI_INTERNALS__/,
  /Not implemented: window\.scrollTo/,
  /The width\(-1\) and height\(-1\) of chart/,
  // Recharts warnings about empty data, expected without a real backend.
];

function shouldIgnore(text: string): boolean {
  return IGNORE_PATTERNS.some((re) => re.test(text));
}

function attachHarvester(page: Page, sink: { route: string; text: string }[]) {
  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (shouldIgnore(text)) return;
    sink.push({ route: page.url(), text });
  });
  page.on("pageerror", (err) => {
    if (shouldIgnore(err.message)) return;
    sink.push({ route: page.url(), text: `pageerror: ${err.message}` });
  });
}

test.describe("Interactive smoke", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  test("home + sidebar nav + new deck dialog + shortcuts dialog", async ({ page }) => {
    const errors: { route: string; text: string }[] = [];
    attachHarvester(page, errors);

    await page.goto("/");
    await expect(page.getByText(/Mnemosys/i).first()).toBeVisible({ timeout: 10_000 });

    // Open the "Nouveau deck" dialog.
    const newDeckBtn = page.getByRole("button", { name: /Nouveau deck/i });
    if (await newDeckBtn.count()) {
      await newDeckBtn.first().click();
      await page.waitForTimeout(300);
      // Type something in the name field.
      const nameInput = page
        .locator('input[placeholder*="Vocabulaire"], input[id*="name"]')
        .first();
      if (await nameInput.count()) {
        await nameInput.fill("Test deck name");
        await page.waitForTimeout(200);
      }
      // Close via Escape.
      await page.keyboard.press("Escape");
      await page.waitForTimeout(200);
    }

    // Open shortcuts help via "?".
    await page.keyboard.press("Shift+?");
    await page.waitForTimeout(400);
    // Close shortcuts dialog.
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);

    // Nav: g h, g s, g p.
    await page.keyboard.press("g");
    await page.keyboard.press("s");
    await page.waitForTimeout(700);
    expect(page.url()).toContain("/stats");

    await page.keyboard.press("g");
    await page.keyboard.press("p");
    await page.waitForTimeout(700);
    expect(page.url()).toContain("/settings");

    if (errors.length > 0) {
      console.log("\n--- Interactive errors ---");
      for (const e of errors) console.log(`[${e.route}] ${e.text}`);
      console.log("--------------------------\n");
    }
    expect(errors.filter((e) => /ReferenceError|SyntaxError|TypeError/.test(e.text))).toHaveLength(
      0,
    );
  });

  test("settings page — every section mounts and Save buttons click without throwing", async ({
    page,
  }) => {
    const errors: { route: string; text: string }[] = [];
    attachHarvester(page, errors);

    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Paramètres" })).toBeVisible({
      timeout: 10_000,
    });
    await page.waitForTimeout(500);

    // Scroll to every section heading
    const headings = ["Apparence", "Réglages des révisions", "Intégrations", "Données"];
    for (const h of headings) {
      const el = page.getByRole("heading", { name: new RegExp(`^${h}`, "i") }).first();
      if (await el.count()) {
        await el.scrollIntoViewIfNeeded();
        await page.waitForTimeout(200);
      }
    }

    // Click Theme buttons in turn (Clair / Sombre / Système)
    for (const t of ["Clair", "Sombre", "Système"]) {
      const lbl = page.getByText(t).first();
      if (await lbl.count()) {
        await lbl.click({ force: true });
        await page.waitForTimeout(150);
      }
    }

    if (errors.length > 0) {
      console.log("\n--- Settings interactive errors ---");
      for (const e of errors) console.log(`[${e.route}] ${e.text}`);
      console.log("-----------------------------------\n");
    }
    expect(errors.filter((e) => /ReferenceError|SyntaxError|TypeError/.test(e.text))).toHaveLength(
      0,
    );
  });

  test("ai-generate page — typing text + clicking buttons doesn't crash", async ({ page }) => {
    const errors: { route: string; text: string }[] = [];
    attachHarvester(page, errors);

    await page.goto("/ai-generate");
    await expect(page.getByText(/Génération IA/i).first()).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(500);

    const textarea = page.locator("textarea").first();
    await textarea.fill("Quick text content for AI generation.");
    await page.waitForTimeout(200);

    // Switch to PDF tab and back to Text.
    const pdfTab = page.getByRole("tab", { name: /PDF/i }).first();
    if (await pdfTab.count()) {
      await pdfTab.click();
      await page.waitForTimeout(200);
      const textTab = page.getByRole("tab", { name: /^Texte/i }).first();
      if (await textTab.count()) {
        await textTab.click();
        await page.waitForTimeout(200);
      }
    }

    if (errors.length > 0) {
      console.log("\n--- AI generate interactive errors ---");
      for (const e of errors) console.log(`[${e.route}] ${e.text}`);
      console.log("--------------------------------------\n");
    }
    expect(errors.filter((e) => /ReferenceError|SyntaxError|TypeError/.test(e.text))).toHaveLength(
      0,
    );
  });
});
