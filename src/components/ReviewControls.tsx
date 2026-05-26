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

import { motion } from "framer-motion";
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

const RATINGS: readonly RatingDef[] = [
  {
    rating: 1,
    label: "Again",
    hotkey: "1",
    className:
      "bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-400 dark:bg-red-700 dark:hover:bg-red-600",
  },
  {
    rating: 2,
    label: "Hard",
    hotkey: "2",
    className:
      "bg-orange-500 text-white hover:bg-orange-600 focus-visible:ring-orange-300 dark:bg-orange-600 dark:hover:bg-orange-500",
  },
  {
    rating: 3,
    label: "Good",
    hotkey: "3",
    className:
      "bg-emerald-600 text-white hover:bg-emerald-700 focus-visible:ring-emerald-400 dark:bg-emerald-700 dark:hover:bg-emerald-600",
  },
  {
    rating: 4,
    label: "Easy",
    hotkey: "4",
    className:
      "bg-sky-600 text-white hover:bg-sky-700 focus-visible:ring-sky-400 dark:bg-sky-700 dark:hover:bg-sky-600",
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
          return (
            <motion.div
              key={r.rating}
              whileHover={isSubmitting ? undefined : { scale: 1.02 }}
              whileTap={isSubmitting ? undefined : { scale: 0.98 }}
              transition={{ duration: 0.1 }}
              className="flex"
            >
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => onRate(r.rating)}
                aria-label={`${r.label} (touche ${r.hotkey})`}
                aria-keyshortcuts={r.hotkey}
                data-testid={`rating-${r.label.toLowerCase()}`}
                className={cn(
                  "flex w-full flex-col items-center justify-center gap-1 rounded-md px-3 py-3 text-sm font-semibold shadow-sm transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  "disabled:opacity-60",
                  r.className,
                )}
              >
                <span className="flex items-center gap-2">
                  <span>{r.label}</span>
                  <span className="rounded border border-white/30 px-1 py-px text-[10px] font-mono opacity-80">
                    {r.hotkey}
                  </span>
                </span>
                <span className="text-[11px] font-normal opacity-90 tabular-nums">
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
