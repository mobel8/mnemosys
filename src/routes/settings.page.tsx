/**
 * Settings page component — extracted from `src/routes/settings.tsx` for
 * code-splitting via `lazyRouteComponent`.
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

import { AboutSection } from "@/components/settings/AboutSection";
import { FsrsOptimizerSection } from "@/components/settings/FsrsOptimizerSection";
import { ImportExportSection } from "@/components/settings/ImportExportSection";
import { IntegrationsSection } from "@/components/settings/IntegrationsSection";
import { NeuroModesSection } from "@/components/settings/NeuroModesSection";
import { ReviewSettingsSection } from "@/components/settings/ReviewSettingsSection";
import { SyncSection } from "@/components/settings/SyncSection";
import { ThemeSection } from "@/components/settings/ThemeSection";

export default function SettingsPage() {
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
      <FsrsOptimizerSection />
      <IntegrationsSection />
      <NeuroModesSection />
      <SyncSection />
      <ImportExportSection />
      <AboutSection />
    </div>
  );
}
