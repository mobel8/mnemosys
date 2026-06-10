/**
 * « Créer » hub — single creation destination of the v0.11 nav. Merges the
 * three former pages (/ai-generate, /capture, /vocabulary) plus the import
 * panel into one tabbed page. The hub owns the page header; tab contents
 * render content only (no h1 of their own).
 *
 * Tab persistence: a module-level variable keeps the active tab across
 * in-session remounts (leave the hub, come back → same tab), and `?tab=`
 * is read once at mount so deep links (`/create?tab=import`) land on the
 * right tab. We deliberately don't write the URL back on tab change: the
 * route definition has no `validateSearch` and a desktop app gains nothing
 * from a live-synced query string.
 *
 * `CaptureOcr` is lazy-loaded because it pulls in the tesseract.js WASM
 * engine — mirrors the on-demand loading the old lazy `/capture` route
 * provided. The other tabs are light and load with the hub chunk.
 */

import { BookA, Import, ScanText, Sparkles } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { AiGenerator } from "@/components/AiGenerator";
import { ImportPanel } from "@/components/settings/ImportPanel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import VocabularyBuilder from "@/components/VocabularyBuilder";
import { lookupLocal } from "@/lib/dictionary";

const CaptureOcr = lazy(() => import("@/components/CaptureOcr"));

const TAB_IDS = ["ai", "ocr", "vocab", "import"] as const;
type CreateTab = (typeof TAB_IDS)[number];

function isCreateTab(value: unknown): value is CreateTab {
  return typeof value === "string" && (TAB_IDS as readonly string[]).includes(value);
}

/** Last active tab — survives unmount/remount within the session. */
let lastTab: CreateTab = "ai";

/** Initial tab: `?tab=` deep link when valid, else the session's last tab. */
function readInitialTab(): CreateTab {
  const fromUrl = new URLSearchParams(window.location.search).get("tab");
  return isCreateTab(fromUrl) ? fromUrl : lastTab;
}

export default function CreatePage() {
  const [tab, setTab] = useState<CreateTab>(readInitialTab);

  function handleTabChange(next: string) {
    if (!isCreateTab(next)) return;
    lastTab = next;
    setTab(next);
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-8 py-8">
      <header>
        <h1 className="font-display text-3xl tracking-tight">Créer</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Génère, capture et importe tes cartes — tout au même endroit.
        </p>
      </header>

      <Tabs value={tab} onValueChange={handleTabChange}>
        <TabsList>
          <TabsTrigger value="ai" className="gap-1.5">
            <Sparkles className="h-4 w-4" aria-hidden />
            Génération IA
          </TabsTrigger>
          <TabsTrigger value="ocr" className="gap-1.5">
            <ScanText className="h-4 w-4" aria-hidden />
            Capture OCR
          </TabsTrigger>
          <TabsTrigger value="vocab" className="gap-1.5">
            <BookA className="h-4 w-4" aria-hidden />
            Vocabulaire
          </TabsTrigger>
          <TabsTrigger value="import" className="gap-1.5">
            <Import className="h-4 w-4" aria-hidden />
            Importer
          </TabsTrigger>
        </TabsList>

        <TabsContent value="ai" className="mt-6 space-y-4">
          <p className="text-sm text-muted-foreground">
            Colle un texte ou choisis un PDF — l'IA propose des cartes à valider avant l'ajout au
            deck.
          </p>
          <AiGenerator />
        </TabsContent>

        <TabsContent value="ocr" className="mt-6 space-y-4">
          <p className="text-sm text-muted-foreground">
            Colle (<kbd className="rounded bg-muted px-1 font-mono text-xs">Ctrl+V</kbd>), dépose ou
            choisis une image : le texte est reconnu hors-ligne puis transformé en cartes.
          </p>
          <Suspense
            fallback={<div className="h-48 w-full animate-pulse rounded-xl bg-muted" aria-hidden />}
          >
            <CaptureOcr />
          </Suspense>
        </TabsContent>

        <TabsContent value="vocab" className="mt-6 space-y-4">
          <p className="text-sm text-muted-foreground">
            Génère des cartes à partir des mots anglais les plus fréquents, traduction incluse quand
            elle est connue.
          </p>
          <VocabularyBuilder translate={(word) => lookupLocal(word)?.fr} />
        </TabsContent>

        <TabsContent value="import" className="mt-6 space-y-4">
          <p className="text-sm text-muted-foreground">
            Importe des paquets et fichiers existants dans ta collection.
          </p>
          <ImportPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
