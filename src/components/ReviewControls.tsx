/**
 * Bottom control strip for the review session.
 *
 * Two layouts, picked by `phase`:
 *   - `question`: a single wide "Voir la réponse" button (Space).
 *   - `answer`:   four rating buttons (Again / Hard / Good / Easy) with the
 *                 next interval preview surfaced underneath each one.
 *
 * Keyboard bindings (Space / 1-4) live in the parent `ReviewSession` so we
 * keep a single source of truth and avoid focus-related races.
 *
 * The "preview next states" call is fetched on demand (per card id) and
 * memoised via TanStack Query, so flipping back and forth or re-rendering
 * the controls doesn't re-hit the backend.
 */

import { motion, useReducedMotion } from "framer-motion";
import { ConfidenceRating } from "@/components/ConfidenceRating";
import { Button } from "@/components/ui/button";
import { formatInterval } from "@/lib/format";
import { useNextStates } from "@/lib/queries";
import type { Rating } from "@/lib/tauri";
import { cn } from "@/lib/utils";

type Phase = "question" | "answer" | "submitting" | "done";

interface ReviewControlsProps {
  phase: Phase;
  cardId: number;
  onFlip: () => void;
  onRate: (rating: Rating) => void;
  /** When a rating is in flight we disable the rest and show a loader. */
  pendingRating?: Rating | null;
  /** Opt-in: render the CBM (1..5) confidence picker above the rating row. */
  confidenceEnabled?: boolean;
  /** Current confidence value (controlled). */
  confidenceValue?: number | null;
  /** Fired when the learner clicks a confidence level. */
  onConfidenceChange?: (value: number) => void;
}

interface RatingDef {
  rating: Rating;
  label: string;
  hotkey: string;
  /** Concrete tailwind classes per button (kept literal for purge). */
  className: string;
}

// P030 — French FSRS grade labels, aligned with HandsFreeReview
// (Encore / Difficile / Bien / Facile). The `data-testid` keys on the
// numeric rating (`rating-1`…`rating-4`) so it stays stable regardless of
// the displayed (now localised) label.
const RATINGS: readonly RatingDef[] = [
  {
    rating: 1,
    label: "Encore",
    hotkey: "1",
    className:
      "bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-destructive",
  },
  {
    rating: 2,
    label: "Difficile",
    hotkey: "2",
    className: "bg-warning text-warning-foreground hover:bg-warning/90 focus-visible:ring-warning",
  },
  {
    rating: 3,
    label: "Bien",
    hotkey: "3",
    className: "bg-success text-success-foreground hover:bg-success/90 focus-visible:ring-success",
  },
  {
    rating: 4,
    label: "Facile",
    hotkey: "4",
    className: "bg-chart-2 text-background hover:bg-chart-2/90 focus-visible:ring-chart-2",
  },
];

export function ReviewControls({
  phase,
  cardId,
  onFlip,
  onRate,
  pendingRating = null,
  confidenceEnabled = false,
  confidenceValue = null,
  onConfidenceChange,
}: ReviewControlsProps) {
  // Only fetch the preview once the answer has been revealed — there's no
  // point in spending IPC on a card the user might just hit Space and ignore.
  const showAnswer = phase === "answer" || phase === "submitting";
  const next = useNextStates(cardId, { enabled: showAnswer });
  // P029 — drop the hover/tap scale micro-interaction for reduced-motion users.
  const reduceMotion = useReducedMotion();

  if (phase === "question") {
    return (
      <div className="flex w-full justify-center pt-2">
        <Button
          type="button"
          size="lg"
          className="min-w-[280px]"
          onClick={onFlip}
          aria-label="Voir la réponse (Espace)"
        >
          Voir la réponse
          <span className="ml-3 rounded border border-primary-foreground/30 px-1.5 py-0.5 text-xs font-mono text-primary-foreground/70">
            Espace
          </span>
        </Button>
      </div>
    );
  }

  const intervals = next.data;
  const isSubmitting = phase === "submitting";

  return (
    <div className="flex w-full max-w-2xl flex-col items-center gap-3">
      {confidenceEnabled && onConfidenceChange ? (
        <ConfidenceRating
          value={confidenceValue}
          onChange={onConfidenceChange}
          disabled={isSubmitting}
        />
      ) : null}
      <div className="grid w-full grid-cols-4 gap-2">
        {RATINGS.map((r) => {
          const interval =
            intervals === undefined
              ? null
              : r.rating === 1
                ? intervals.again.interval_days
                : r.rating === 2
                  ? intervals.hard.interval_days
                  : r.rating === 3
                    ? intervals.good.interval_days
                    : intervals.easy.interval_days;
          const isPending = pendingRating === r.rating;
          // P105 — describe the whole button to screen readers: the grade, the
          // planned next interval (or its loading / error state), and the
          // shortcut. The visual chip below only ever showed `…` / `—` /
          // `7 j`, none of which a SR announced beyond the bare label.
          const intervalAria = isPending
            ? "enregistrement en cours"
            : next.isError
              ? "intervalle indisponible"
              : interval === null
                ? "calcul de l'intervalle en cours"
                : `prochaine révision ${intervalToSpeech(interval)}`;
          return (
            <motion.div
              key={r.rating}
              whileHover={isSubmitting || reduceMotion ? undefined : { scale: 1.02 }}
              whileTap={isSubmitting || reduceMotion ? undefined : { scale: 0.98 }}
              transition={{ duration: 0.1 }}
              className="flex"
            >
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => onRate(r.rating)}
                aria-label={`${r.label}, ${intervalAria} (touche ${r.hotkey})`}
                aria-keyshortcuts={r.hotkey}
                aria-busy={isPending || (interval === null && !next.isError)}
                data-testid={`rating-${r.rating}`}
                className={cn(
                  "flex w-full flex-col items-center justify-center gap-1 rounded-md px-3 py-3 text-sm font-semibold shadow-sm transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  "disabled:opacity-60",
                  r.className,
                )}
              >
                <span className="flex items-center gap-2">
                  <span>{r.label}</span>
                  <span className="rounded border border-current/30 px-1 py-px font-mono text-[10px] opacity-80">
                    {r.hotkey}
                  </span>
                </span>
                {/* P105 — visual chip stays terse; `aria-hidden` so the SR uses
                    the richer `aria-label` above instead of double-reading the
                    `…` / `—` glyph. */}
                <span
                  aria-hidden
                  className="font-mono text-[11px] font-normal tabular-nums opacity-90"
                >
                  {isPending ? "…" : interval === null ? "—" : formatInterval(interval)}
                </span>
              </button>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * P105 — spell out an FSRS interval (in possibly-fractional days) as a French
 * phrase for screen readers (« dans 7 jours », « dans 10 minutes »). Mirrors
 * the buckets of `formatInterval` but uses full words instead of the terse
 * visual abbreviations a SR would mispronounce (« j », « h »).
 */
function intervalToSpeech(days: number): string {
  if (!Number.isFinite(days) || days < 0) return "indisponible";
  if (days === 0) return "dans moins de 10 minutes";
  if (days < 1) {
    const totalMinutes = Math.max(1, Math.round(days * 24 * 60));
    if (totalMinutes < 60) {
      return `dans ${totalMinutes} minute${totalMinutes > 1 ? "s" : ""}`;
    }
    const hours = Math.round(days * 24 * 10) / 10;
    const rounded = Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
    return `dans ${rounded} heure${hours > 1 ? "s" : ""}`;
  }
  if (days === 1) return "dans 1 jour";
  if (days < 30) return `dans ${Math.round(days)} jours`;
  if (days < 365) {
    const months = Number((days / 30).toFixed(1));
    return `dans ${months} mois`;
  }
  const years = Number((days / 365).toFixed(1));
  return `dans ${years} an${years > 1 ? "s" : ""}`;
}
