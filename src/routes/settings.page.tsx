/**
 * Settings page component — extracted from `src/routes/settings.tsx` for
 * code-splitting via `lazyRouteComponent`.
 *
 * v0.11 — the old vertical stack of 8 cards became 7 tabs, each grouping
 * self-contained sections that manage their own state and IPC calls:
 *
 *   - Apparence : <ThemeSection>
 *   - Révision  : <ReviewSettingsSection> + <FsrsOptimizerSection>
 *   - IA & Audio: <IntegrationsSection> (API keys, Ollama, TTS, Piper)
 *   - Rappels   : <RemindersSection> (absorbed from the former /planner page)
 *   - Données   : <ImportExportSection> (export + <ImportPanel>)
 *   - Labs      : <LabsSection> (experimental review modes)
 *   - À propos  : <AboutSection>
 */

import { AboutSection } from "@/components/settings/AboutSection";
import { FsrsOptimizerSection } from "@/components/settings/FsrsOptimizerSection";
import { ImportExportSection } from "@/components/settings/ImportExportSection";
import { IntegrationsSection } from "@/components/settings/IntegrationsSection";
import { LabsSection } from "@/components/settings/LabsSection";
import { RemindersSection } from "@/components/settings/RemindersSection";
import { ReviewSettingsSection } from "@/components/settings/ReviewSettingsSection";
import { ThemeSection } from "@/components/settings/ThemeSection";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const TABS = [
  { value: "apparence", label: "Apparence" },
  { value: "revision", label: "Révision" },
  { value: "ia-audio", label: "IA & Audio" },
  { value: "rappels", label: "Rappels" },
  { value: "donnees", label: "Données" },
  { value: "labs", label: "Labs" },
  { value: "a-propos", label: "À propos" },
] as const;

export default function SettingsPage() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Paramètres</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Personnalise l'apparence, les révisions, et gère ta collection.
        </p>
      </header>

      <Tabs defaultValue="apparence">
        {/* `h-auto flex-wrap` so the 7 triggers wrap instead of overflowing
            the max-w-3xl column on narrow windows. */}
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1">
          {TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="apparence" className="mt-4">
          <ThemeSection />
        </TabsContent>

        <TabsContent value="revision" className="mt-4 space-y-6">
          <ReviewSettingsSection />
          <FsrsOptimizerSection />
        </TabsContent>

        <TabsContent value="ia-audio" className="mt-4">
          <IntegrationsSection />
        </TabsContent>

        <TabsContent value="rappels" className="mt-4">
          <RemindersSection />
        </TabsContent>

        <TabsContent value="donnees" className="mt-4">
          <ImportExportSection />
        </TabsContent>

        <TabsContent value="labs" className="mt-4">
          <LabsSection />
        </TabsContent>

        <TabsContent value="a-propos" className="mt-4">
          <AboutSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}
