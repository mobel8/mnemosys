/**
 * Focus Guard — Vague 12 (mind-wandering detection via webcam, Hutt et al.,
 * ACM 2024).
 *
 * Strictly opt-in and 100% local: WebGazer runs entirely in the renderer,
 * no frame ever leaves the device. When the learner's gaze drifts off the
 * card area (or no face is detected) for more than {@link OFF_CARD_GRACE_MS},
 * a discreet « Toujours concentré ? » nudge appears in the corner. The nudge
 * clears as soon as attention returns.
 *
 * Privacy + safety design:
 *   - **Consent gate**: the first time the guard would activate we show a
 *     modal explaining the webcam usage. The decision is persisted in
 *     `localStorage` so we never re-prompt once answered. Declining keeps
 *     the guard dormant for the rest of the session (the learner can still
 *     flip the Settings toggle off).
 *   - **jsdom / no-camera no-op**: if `navigator.mediaDevices` is absent we
 *     bail before importing WebGazer at all. This keeps unit tests (and any
 *     headless environment) from loading the heavy TFJS/mediapipe bundle.
 *   - **Dynamic import**: WebGazer is `import()`-ed lazily so its
 *     `document`/`navigator` side-effects only run when the feature is truly
 *     engaged, and the main bundle stays lean for users who never enable it.
 *   - **Cleanup**: on unmount we clear the gaze listener and call
 *     `webgazer.end()` to release the camera + DOM nodes.
 */

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** How long the gaze must stay off-card before we nudge (ms). */
const OFF_CARD_GRACE_MS = 5000;
/** Persisted consent decision. */
const CONSENT_KEY = "mnemosys.focusGuard.consent";

type Consent = "granted" | "denied" | "unknown";

function readConsent(): Consent {
  try {
    const v = localStorage.getItem(CONSENT_KEY);
    return v === "granted" || v === "denied" ? v : "unknown";
  } catch {
    return "unknown";
  }
}

function writeConsent(value: Exclude<Consent, "unknown">) {
  try {
    localStorage.setItem(CONSENT_KEY, value);
  } catch {
    // Private-mode / disabled storage — fall back to in-memory only.
  }
}

/** Minimal shape of the WebGazer gaze sample we rely on. */
interface GazeData {
  x: number;
  y: number;
}

/** The slice of the WebGazer API we actually use (no official types ship). */
interface WebGazerLike {
  setGazeListener: (cb: (data: GazeData | null, elapsed: number) => void) => WebGazerLike;
  clearGazeListener: () => WebGazerLike;
  showVideo: (on: boolean) => WebGazerLike;
  showFaceOverlay: (on: boolean) => WebGazerLike;
  showFaceFeedbackBox: (on: boolean) => WebGazerLike;
  showPredictionPoints: (on: boolean) => WebGazerLike;
  begin: (onFail?: () => void) => Promise<unknown> | unknown;
  end: () => void;
}

interface FocusGuardProps {
  /** Master gate from settings. When false the component renders nothing. */
  enabled: boolean;
}

export function FocusGuard({ enabled }: FocusGuardProps) {
  // jsdom / headless guard — decided once, synchronously, before any import.
  const hasMediaDevices =
    typeof navigator !== "undefined" && typeof navigator.mediaDevices !== "undefined";

  const [consent, setConsent] = useState<Consent>(() => (enabled ? readConsent() : "unknown"));
  const [nudge, setNudge] = useState(false);

  // Refs so the gaze callback (created once) always sees fresh values.
  const offCardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const webgazerRef = useRef<WebGazerLike | null>(null);

  const showConsentModal = enabled && hasMediaDevices && consent === "unknown";
  const active = enabled && hasMediaDevices && consent === "granted";

  // ---- WebGazer lifecycle -------------------------------------------------
  useEffect(() => {
    if (!active) return;

    let cancelled = false;

    const clearOffCardTimer = () => {
      if (offCardTimerRef.current !== null) {
        clearTimeout(offCardTimerRef.current);
        offCardTimerRef.current = null;
      }
    };

    // Is the gaze point inside the visible card column? We treat the central
    // band of the viewport as « the card » — robust to layout changes and
    // avoids coupling to a specific DOM node.
    const isOnCard = (x: number, y: number): boolean => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      // Central 80% horizontally, top 90% vertically (controls live low).
      return x >= w * 0.1 && x <= w * 0.9 && y >= 0 && y <= h * 0.9;
    };

    const onGaze = (data: GazeData | null) => {
      // No face / lost tracking, or gaze off the card → start the grace timer.
      const wandering = data === null || !isOnCard(data.x, data.y);
      if (wandering) {
        if (offCardTimerRef.current === null) {
          offCardTimerRef.current = setTimeout(() => {
            setNudge(true);
          }, OFF_CARD_GRACE_MS);
        }
      } else {
        clearOffCardTimer();
        setNudge(false);
      }
    };

    void (async () => {
      try {
        const mod = await import("webgazer");
        if (cancelled) return;
        // The ambient `webgazer` typings expose a structurally-compatible
        // default export; assign through our local interface directly.
        const wg: WebGazerLike = mod.default;
        webgazerRef.current = wg;
        wg.setGazeListener(onGaze);
        // Keep the UI clean: no debug video / dots / overlays on screen.
        wg.showVideo(false);
        wg.showFaceOverlay(false);
        wg.showFaceFeedbackBox(false);
        wg.showPredictionPoints(false);
        await wg.begin(() => {
          // Camera permission denied or init failed — stay silent rather than
          // nagging; the learner already consented, hardware just said no.
        });
      } catch {
        // Lib failed to load/initialise — degrade to a no-op silently.
      }
    })();

    return () => {
      cancelled = true;
      clearOffCardTimer();
      const wg = webgazerRef.current;
      webgazerRef.current = null;
      if (wg) {
        try {
          wg.clearGazeListener();
          wg.end();
        } catch {
          // Best-effort teardown.
        }
      }
    };
  }, [active]);

  if (!enabled || !hasMediaDevices) return null;

  return (
    <>
      <Dialog open={showConsentModal}>
        <DialogContent data-testid="focus-guard-consent">
          <DialogHeader>
            <DialogTitle>Activer Focus Guard ?</DialogTitle>
            <DialogDescription>
              Focus Guard utilise ta webcam <strong>localement</strong> pour repérer les moments où
              ton attention décroche. Aucune vidéo n'est enregistrée ni envoyée nulle part — tout
              reste sur cet appareil. Tu peux refuser et continuer normalement.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              data-testid="focus-guard-deny"
              onClick={() => {
                writeConsent("denied");
                setConsent("denied");
              }}
            >
              Non, merci
            </Button>
            <Button
              data-testid="focus-guard-grant"
              onClick={() => {
                writeConsent("granted");
                setConsent("granted");
              }}
            >
              Activer la webcam
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {nudge && (
        <div
          className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full border border-amber-500/40 bg-amber-500/15 px-4 py-2 text-sm font-medium text-amber-700 shadow-lg backdrop-blur dark:text-amber-300"
          role="status"
          data-testid="focus-guard-nudge"
        >
          👀 Toujours concentré ?
        </div>
      )}
    </>
  );
}
