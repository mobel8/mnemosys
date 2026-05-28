/**
 * Shadowing Mode page (Vague 17 — Arguelles / polyglot shadowing). Listen to
 * a TTS reference, record yourself, and compare the two waveforms. Pure
 * frontend (Web Audio + MediaRecorder + the existing TTS command).
 */

import { AudioLines } from "lucide-react";
import { ShadowingPractice } from "@/components/ShadowingPractice";

export default function ShadowingPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <header>
        <h2 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <AudioLines className="h-6 w-6" /> Shadowing
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Écoute une phrase modèle, répète-la par-dessus en t'enregistrant, puis compare ta forme
          d'onde à la référence pour caler ton rythme et ton accentuation.
        </p>
      </header>

      <ShadowingPractice />
    </div>
  );
}
