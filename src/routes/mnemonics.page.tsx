/**
 * Mnemonics page (Vague 21 — Major System / PAO helper). Converts a number
 * into its consonant skeleton and suggests memorable French words, the
 * technique memory athletes use to encode digits. Pure frontend.
 */

import { Binary } from "lucide-react";
import { MajorSystemHelper } from "@/components/MajorSystemHelper";

export default function MnemonicsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <header>
        <h1 className="flex items-center gap-2 font-display text-2xl font-semibold tracking-tight">
          <Binary className="h-6 w-6 text-brand-500" /> Mnémotechnique
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Le Major System transforme des chiffres en sons consonnes, puis en mots et images
          mémorables. Couplé au PAO (Personne-Action-Objet), c'est la méthode des athlètes de la
          mémoire pour retenir de longues suites de chiffres.
        </p>
      </header>

      <MajorSystemHelper />
    </div>
  );
}
