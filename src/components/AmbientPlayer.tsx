/**
 * Context ambient-sound player (Vague 18 — Godden & Baddeley 1975).
 *
 * Mounted by `ReviewSession` only when `ambient_sound !== "none"`. Renders
 * nothing: its sole job is to spin up the looping soundscape on mount and tear
 * it down on unmount (i.e. when the learner leaves the session). The Web Audio
 * graph lives entirely in `lib/ambient.ts`.
 *
 * Re-creating the controller when `kind` changes keeps the player honest if the
 * setting is toggled mid-session (rare, but cheap to support).
 */

import { useEffect } from "react";
import { type AmbientKind, createAmbient } from "@/lib/ambient";

interface AmbientPlayerProps {
  /** Which soundscape to play. `"none"` is a no-op (the parent normally gates this). */
  kind: AmbientKind;
}

export function AmbientPlayer({ kind }: AmbientPlayerProps) {
  useEffect(() => {
    if (kind === "none") return;
    const controller = createAmbient(kind);
    controller.start();
    return () => {
      controller.stop();
    };
  }, [kind]);

  return null;
}
