/**
 * Reading Import page (Vague 17 — LingQ-style extensive reading). Paste a
 * text, classify each word (new / learning / known), and mint cards from the
 * words you're acquiring. Backed by the `word_status` table (migration v14).
 */

import { BookOpen } from "lucide-react";
import { ReadingImport } from "@/components/ReadingImport";

export default function ReadingPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <header>
        <h2 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <BookOpen className="h-6 w-6" /> Lecture
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Lis un texte dans ta langue cible. Marque les mots que tu connais ou que tu apprends, puis
          transforme les mots en cours d'acquisition en cartes.
        </p>
      </header>

      <ReadingImport />
    </div>
  );
}
