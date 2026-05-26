/**
 * Settings page.
 *
 * Composed of four self-contained sub-sections so each can manage its own
 * state and IPC calls independently:
 *
 *   1. <ThemeSection>          : light / dark / system picker
 *   2. <ReviewSettingsSection> : FSRS retention + daily caps + UI toggles
 *   3. <ImportExportSection>   : JSON round-trip (owned by C2)
 *   4. <AboutSection>          : version, credits, replay-wizard button
 *
 * The sections are stacked vertically inside a max-width column rather than
 * tabbed because the page is short enough that scanning is faster than a
 * tab click. Should the surface grow past one screen, swap the stack for
 * `<Tabs>` from `@/components/ui/tabs`.
 */

import { createRoute } from "@tanstack/react-router";
import { AboutSection } from "@/components/settings/AboutSection";
import { ImportExportSection } from "@/components/settings/ImportExportSection";
import { ReviewSettingsSection } from "@/components/settings/ReviewSettingsSection";
import { ThemeSection } from "@/components/settings/ThemeSection";
import { Route as rootRoute } from "./__root";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsPage,
});

function SettingsPage() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Paramètres</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Personnalise l'apparence, les révisions, et gère ta collection.
        </p>
      </header>

      <ThemeSection />
      <ReviewSettingsSection />
      <ImportExportSection />
      <AboutSection />
    </div>
  );
}
