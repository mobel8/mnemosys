/**
 * Mood / Sleep / Stress pre-session check-in (Vague 3 — opt-in).
 *
 * Modal shown at the start of a review session when:
 *   1. `neuro_modes_enabled` is `true`
 *   2. `mood_checkin_enabled` is `true`
 *   3. No wellness log exists for today yet
 *
 * Every slider can be skipped (a `null` value persists). Two boolean flags
 * (hydrated / caffeine) are tri-state in spirit: the learner toggles them
 * if relevant. The "Valider" button always submits; "Passer" closes
 * without persisting anything.
 *
 * Disclaimers are gated on the live slider values:
 *   - sleep_hours < 6  → suggest a maintenance-only day
 *   - stress_level >= 4 → suggest the cyclic-sighing primer
 *
 * Evidence: sleep deprivation meta-analysis g≈0.621; Spiegel et al. Cell
 * Reports Medicine 2023 for the cyclic-sighing pointer.
 */

import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useSubmitWellness } from "@/lib/queries";
import type { WellnessLog } from "@/lib/tauri";
import { cn } from "@/lib/utils";

interface MoodCheckInProps {
  open: boolean;
  onClose: () => void;
  /**
   * Fired with the freshly-persisted log after a successful submission.
   * The parent is responsible for hiding the dialog (`onClose`) — `onSubmit`
   * is purely a notification hook so callers can react (e.g. open the
   * cyclic-sighing primer when stress >= 4).
   */
  onSubmit?: (log: WellnessLog) => void;
}

const MOOD_OPTIONS: { value: number; emoji: string; label: string }[] = [
  { value: 1, emoji: "😞", label: "Très bas" },
  { value: 2, emoji: "😟", label: "Bas" },
  { value: 3, emoji: "😐", label: "Neutre" },
  { value: 4, emoji: "🙂", label: "Bien" },
  { value: 5, emoji: "😄", label: "Très bien" },
];

export function MoodCheckIn({ open, onClose, onSubmit }: MoodCheckInProps) {
  const [mood, setMood] = useState<number | null>(null);
  const [sleepHours, setSleepHours] = useState<number | null>(null);
  const [stressLevel, setStressLevel] = useState<number | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [caffeineTaken, setCaffeineTaken] = useState(false);

  const submit = useSubmitWellness();

  // Reset the form every time the dialog is reopened so stale values from a
  // previous session don't leak across days.
  useEffect(() => {
    if (open) {
      setMood(null);
      setSleepHours(null);
      setStressLevel(null);
      setHydrated(false);
      setCaffeineTaken(false);
    }
  }, [open]);

  const lowSleep = sleepHours !== null && sleepHours < 6;
  const highStress = stressLevel !== null && stressLevel >= 4;

  function handleValidate() {
    submit.mutate(
      {
        mood,
        sleepHours,
        stressLevel,
        hydrated,
        caffeineTaken,
      },
      {
        onSuccess: (log) => {
          onSubmit?.(log);
          onClose();
        },
      },
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        className="max-w-md"
        data-testid="mood-checkin-dialog"
        // Prevent backdrop-click dismissal so a stray click doesn't skip
        // the check-in by accident; the user must hit "Passer" explicitly.
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Check-in pré-session</DialogTitle>
          <DialogDescription>
            Quelques questions optionnelles avant de réviser. Tu peux tout passer.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-2">
          {/* Mood — 5 emoji buttons */}
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Comment te sens-tu maintenant ?</legend>
            <div className="flex items-center justify-between gap-1">
              {MOOD_OPTIONS.map((opt) => {
                const isActive = mood === opt.value;
                return (
                  <Button
                    key={opt.value}
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-pressed={isActive}
                    aria-label={`Humeur ${opt.value} : ${opt.label}`}
                    data-testid={`mood-${opt.value}`}
                    onClick={() => setMood(opt.value)}
                    className={cn(
                      "h-12 w-12 text-2xl",
                      isActive && "ring-2 ring-primary/60 ring-offset-2 ring-offset-background",
                    )}
                  >
                    {opt.emoji}
                  </Button>
                );
              })}
            </div>
          </fieldset>

          {/* Sleep slider */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="sleep-slider" className="text-sm">
                Combien d'heures la nuit dernière&nbsp;?
              </Label>
              <span className="tabular-nums text-sm font-semibold text-primary">
                {sleepHours === null ? "—" : `${sleepHours.toFixed(1)}h`}
              </span>
            </div>
            <Slider
              id="sleep-slider"
              min={0}
              max={12}
              step={0.5}
              value={[sleepHours ?? 7.5]}
              onValueChange={([v]) => setSleepHours(typeof v === "number" ? v : sleepHours)}
              data-testid="sleep-slider"
            />
          </div>

          {/* Stress slider */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="stress-slider" className="text-sm">
                Niveau de stress ?
              </Label>
              <span className="tabular-nums text-sm font-semibold text-primary">
                {stressLevel === null ? "—" : `${stressLevel}/5`}
              </span>
            </div>
            <Slider
              id="stress-slider"
              min={1}
              max={5}
              step={1}
              value={[stressLevel ?? 3]}
              onValueChange={([v]) =>
                setStressLevel(typeof v === "number" ? Math.round(v) : stressLevel)
              }
              data-testid="stress-slider"
            />
          </div>

          {/* Toggles */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm">
              <Label htmlFor="hydrated-switch">Hydraté</Label>
              <Switch
                id="hydrated-switch"
                checked={hydrated}
                onCheckedChange={setHydrated}
                data-testid="hydrated-switch"
              />
            </div>
            <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm">
              <Label htmlFor="caffeine-switch">Caféine</Label>
              <Switch
                id="caffeine-switch"
                checked={caffeineTaken}
                onCheckedChange={setCaffeineTaken}
                data-testid="caffeine-switch"
              />
            </div>
          </div>

          {/* Conditional disclaimers */}
          {lowSleep && (
            <div
              className="rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-100"
              data-testid="low-sleep-disclaimer"
            >
              Sommeil &lt; 6h. Mode <strong>« maintenance only »</strong> suggéré pour ne pas
              surcharger ta journée.
            </div>
          )}
          {highStress && (
            <div
              className="rounded-md border border-blue-300/60 bg-blue-50 px-3 py-2 text-xs text-blue-900 dark:border-blue-700/60 dark:bg-blue-950/40 dark:text-blue-100"
              data-testid="high-stress-disclaimer"
            >
              Stress élevé. Préfère sessions courtes + <strong>cyclic sighing</strong>.
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={submit.isPending}
            data-testid="mood-skip"
          >
            Passer
          </Button>
          <Button
            type="button"
            onClick={handleValidate}
            disabled={submit.isPending}
            data-testid="mood-submit"
          >
            {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Valider
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
