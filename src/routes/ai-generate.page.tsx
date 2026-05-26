/**
 * AI card generation page — thin wrapper around `<AiGenerator />`. The actual
 * orchestration lives in `src/components/AiGenerator.tsx` so the route
 * stays a layout-only shell, matching the convention used by
 * `settings.page.tsx`.
 */

import { AiGenerator } from "@/components/AiGenerator";

export default function AiGenerateRoute() {
  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Génération IA de cartes</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Colle un texte ou choisis un PDF, valide les cartes proposées par Claude, puis ajoute-les
          au deck de ton choix.
        </p>
      </header>

      <AiGenerator />
    </div>
  );
}
