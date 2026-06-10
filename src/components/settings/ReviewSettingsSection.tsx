/**
 * Settings → "Révision".
 *
 * Surfaces the scheduling knobs (default retention for new decks, daily caps)
 * plus the two active-recall options that stayed in core (type-the-answer,
 * confidence rating). Values live in `AppSettings` on the backend; we hydrate
 * via `useSettingsQuery()` and persist with `useSaveSettings()`.
 *
 * "Save" is a single bulk-write rather than per-field auto-save, mostly to
 * avoid spamming the backend while a slider is being dragged. The local
 * draft state is reset whenever a fresh server payload arrives so other
 * agents that mutate settings don't get clobbered.
 *
 * Everything experimental (sketch, voice answer, hands-free, ambience) lives
 * in `<LabsSection>`; the removed features (pre-questioning, JOL, pretest,
 * self-explanation, focus guard) are gone from `AppSettings` entirely.
 */

import { Loader2, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/use-toast";
import { useSaveSettings, useSettingsQuery } from "@/lib/queries";
import { DEFAULT_SETTINGS as DEFAULTS } from "@/lib/stores/settings";
import type { AppSettings } from "@/lib/tauri";

const RETENTION_MIN = 0.8;
const RETENTION_MAX = 0.97;
const RETENTION_STEP = 0.01;

function clamp(value: number, min: number, max: number) {
  if (Number.isNaN(value)) return min;
  return Math.min(Math.max(value, min), max);
}

export function ReviewSettingsSection() {
  const query = useSettingsQuery();
  const save = useSaveSettings({
    onSuccess: () => {
      toast({ title: "Paramètres enregistrés" });
    },
    onError: (err) => {
      toast({
        title: "Échec de la sauvegarde",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  // Local draft so sliders/inputs feel snappy without firing IPC per keystroke.
  const [draft, setDraft] = useState<AppSettings>(DEFAULTS);

  // Re-sync whenever the cached settings change (initial load, external save).
  useEffect(() => {
    if (query.data) {
      setDraft(query.data);
    }
  }, [query.data]);

  const dirty = useMemo(() => {
    if (!query.data) return false;
    const a = query.data;
    const b = draft;
    return (
      a.desired_retention !== b.desired_retention ||
      a.daily_new_limit !== b.daily_new_limit ||
      a.daily_review_limit !== b.daily_review_limit ||
      a.show_next_interval !== b.show_next_interval ||
      a.type_the_answer_enabled !== b.type_the_answer_enabled ||
      a.confidence_rating_enabled !== b.confidence_rating_enabled
    );
  }, [query.data, draft]);

  function onSave() {
    // Keep the theme from the latest server payload — Theme is owned by
    // <ThemeSection /> and may have changed since we hydrated.
    save.mutate({
      ...(query.data ?? DEFAULTS),
      desired_retention: clamp(draft.desired_retention, RETENTION_MIN, RETENTION_MAX),
      daily_new_limit: clamp(Math.round(draft.daily_new_limit), 1, 200),
      daily_review_limit: clamp(Math.round(draft.daily_review_limit), 10, 1000),
      show_next_interval: draft.show_next_interval,
      type_the_answer_enabled: draft.type_the_answer_enabled,
      confidence_rating_enabled: draft.confidence_rating_enabled,
    });
  }

  const retentionPct = Math.round(draft.desired_retention * 100);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Réglages des révisions</CardTitle>
        <CardDescription>
          Ajuste le rythme journalier et les options de rappel actif. Les changements ne
          s'appliquent qu'après sauvegarde.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Default retention for new decks */}
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="retention-slider" className="text-sm">
              Rétention par défaut des nouveaux decks
            </Label>
            <span className="tabular-nums text-sm font-semibold text-primary">{retentionPct}%</span>
          </div>
          <Slider
            id="retention-slider"
            aria-label="Rétention par défaut des nouveaux decks"
            aria-valuetext={`${retentionPct} %`}
            min={RETENTION_MIN}
            max={RETENTION_MAX}
            step={RETENTION_STEP}
            value={[draft.desired_retention]}
            onValueChange={([v]) =>
              setDraft((d) => ({
                ...d,
                desired_retention: typeof v === "number" ? v : d.desired_retention,
              }))
            }
            disabled={query.isLoading}
          />
          <p className="text-xs text-muted-foreground">
            La planification utilise la rétention propre à chaque deck.
          </p>
        </div>

        {/* Daily new limit */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="daily-new" className="text-sm">
              Nouvelles cartes par jour
            </Label>
            <Input
              id="daily-new"
              type="number"
              min={1}
              max={200}
              step={1}
              value={draft.daily_new_limit}
              disabled={query.isLoading}
              onChange={(e) => setDraft((d) => ({ ...d, daily_new_limit: Number(e.target.value) }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="daily-review" className="text-sm">
              Reviews par jour
            </Label>
            <Input
              id="daily-review"
              type="number"
              min={10}
              max={1000}
              step={10}
              value={draft.daily_review_limit}
              disabled={query.isLoading}
              onChange={(e) =>
                setDraft((d) => ({ ...d, daily_review_limit: Number(e.target.value) }))
              }
            />
          </div>
        </div>

        {/* Show next interval */}
        <div className="flex items-center justify-between gap-4 rounded-md border bg-muted/30 px-4 py-3">
          <div className="space-y-0.5">
            <Label htmlFor="show-interval" className="text-sm">
              Afficher les intervalles dans les boutons
            </Label>
            <p className="text-xs text-muted-foreground">
              Affiche « +3j » sous chaque bouton Again / Hard / Good / Easy pendant les révisions.
            </p>
          </div>
          <Switch
            id="show-interval"
            checked={draft.show_next_interval}
            disabled={query.isLoading}
            onCheckedChange={(checked) => setDraft((d) => ({ ...d, show_next_interval: checked }))}
          />
        </div>

        {/* Active recall options */}
        <div className="space-y-3">
          <div className="text-sm font-medium text-foreground">Rappel actif</div>
          <div className="flex items-center justify-between gap-4 rounded-md border bg-muted/30 px-4 py-3">
            <div className="space-y-0.5">
              <Label htmlFor="type-the-answer-toggle" className="text-sm">
                Saisie de la réponse
              </Label>
              <p className="text-xs text-muted-foreground">
                Tape ta réponse avant de retourner la carte.
              </p>
            </div>
            <Switch
              id="type-the-answer-toggle"
              checked={draft.type_the_answer_enabled}
              disabled={query.isLoading}
              onCheckedChange={(checked) =>
                setDraft((d) => ({ ...d, type_the_answer_enabled: checked }))
              }
            />
          </div>
          <div className="flex items-center justify-between gap-4 rounded-md border bg-muted/30 px-4 py-3">
            <div className="space-y-0.5">
              <Label htmlFor="confidence-rating-toggle" className="text-sm">
                Évaluation de confiance
              </Label>
              <p className="text-xs text-muted-foreground">
                Note ta confiance avant de voir la réponse ; alimente l'onglet Calibration des
                statistiques.
              </p>
            </div>
            <Switch
              id="confidence-rating-toggle"
              checked={draft.confidence_rating_enabled}
              disabled={query.isLoading}
              onCheckedChange={(checked) =>
                setDraft((d) => ({ ...d, confidence_rating_enabled: checked }))
              }
            />
          </div>
        </div>

        <div className="flex justify-end">
          <Button onClick={onSave} disabled={!dirty || save.isPending}>
            {save.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Sauvegarder
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
