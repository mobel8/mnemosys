/**
 * Hub « Langues » (v0.11) — fusionne les trois anciennes pages langues en une
 * seule page à onglets :
 *
 *   - « Lecture »       — import de texte LingQ-style (`<ReadingImport />`),
 *                         anciennement `/reading`.
 *   - « Shadowing »     — boucle écoute → imitation → comparaison
 *                         (`<ShadowingPractice />`), anciennement `/shadowing`.
 *   - « Prononciation » — drill de paires minimales (`<MinimalPairsDrill />`),
 *                         anciennement `/pronunciation`.
 *
 * L'onglet initial peut être ciblé en deep-link : `/language?tab=shadowing`.
 * La route ne déclare pas de `validateSearch`, donc le paramètre est lu de
 * façon défensive (valeur inconnue → onglet « Lecture »). Les onglets Radix
 * démontent le contenu inactif, ce qui déclenche les teardowns audio des
 * sous-features (AudioContext, MediaRecorder, SpeechSynthesis) au changement
 * d'onglet — aucun son ne survit à la navigation.
 */

import { useSearch } from "@tanstack/react-router";
import { AudioLines, BookOpen, Headphones } from "lucide-react";
import { useState } from "react";
import MinimalPairsDrill from "@/components/MinimalPairsDrill";
import { ReadingImport } from "@/components/ReadingImport";
import { ShadowingPractice } from "@/components/ShadowingPractice";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const TAB_VALUES = ["reading", "shadowing", "pronunciation"] as const;
type TabValue = (typeof TAB_VALUES)[number];

function isTabValue(value: unknown): value is TabValue {
  return typeof value === "string" && (TAB_VALUES as readonly string[]).includes(value);
}

export default function LanguagePage() {
  // Aucune route ne déclare de schéma de recherche : le paramètre `?tab=` est
  // donc lu en mode non-strict et validé à la main avant usage.
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const [tab, setTab] = useState<TabValue>(() => (isTabValue(search.tab) ? search.tab : "reading"));

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-6" data-testid="language-hub">
      <header>
        <h1 className="font-display text-3xl tracking-tight">Langues</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Lis, écoute et répète dans ta langue cible.
        </p>
      </header>

      <Tabs value={tab} onValueChange={(value) => setTab(value as TabValue)}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="reading" className="gap-1.5">
            <BookOpen className="h-4 w-4" aria-hidden />
            Lecture
          </TabsTrigger>
          <TabsTrigger value="shadowing" className="gap-1.5">
            <AudioLines className="h-4 w-4" aria-hidden />
            Shadowing
          </TabsTrigger>
          <TabsTrigger value="pronunciation" className="gap-1.5">
            <Headphones className="h-4 w-4" aria-hidden />
            Prononciation
          </TabsTrigger>
        </TabsList>

        <TabsContent value="reading" className="mt-4 space-y-4">
          <p className="text-sm text-muted-foreground">
            Colle un texte, classe chaque mot (inconnu, en cours, connu), puis transforme les mots
            en cours d'acquisition en cartes.
          </p>
          <ReadingImport />
        </TabsContent>

        <TabsContent value="shadowing" className="mt-4 space-y-4">
          <p className="text-sm text-muted-foreground">
            Écoute une phrase modèle, répète-la en t'enregistrant, puis compare ta forme d'onde à la
            référence.
          </p>
          <ShadowingPractice />
        </TabsContent>

        <TabsContent value="pronunciation" className="mt-4 space-y-4">
          <p className="text-sm text-muted-foreground">
            Choisis un contraste, écoute le mot prononcé, puis clique sur celui que tu penses avoir
            entendu.
          </p>
          <MinimalPairsDrill />
        </TabsContent>
      </Tabs>
    </div>
  );
}
