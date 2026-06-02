/**
 * Settings → "Modes neuro (opt-in)" — Vague 3.
 *
 * All four controls are gated behind a master switch (`neuro_modes_enabled`).
 * When the master is off, the sub-toggles are visually disabled and any
 * persisted value stays inert (the consumer components check the master).
 *
 * Evidence-based defaults:
 *   - Mood/Sleep check-in : meta-analysis on sleep deprivation g≈0.621.
 *   - Movement break      : Roig et al., acute exercise + memory d≈0.52.
 *   - Cyclic sighing      : Spiegel et al., Cell Reports Medicine 2023.
 */

import { Loader2, Moon, Save, Volume2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { CHRONOTYPE_INFO, type Chronotype, ChronotypeQuiz } from "@/components/ChronotypeQuiz";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/use-toast";
import { type AmbientKind, createAmbient } from "@/lib/ambient";
import { useSaveSettings, useSettingsQuery } from "@/lib/queries";
import type { AppSettings } from "@/lib/tauri";

/** Ambient-sound dropdown options. */
const AMBIENT_OPTIONS: { value: AmbientKind; label: string }[] = [
  { value: "none", label: "Aucune" },
  { value: "white", label: "Bruit blanc" },
  { value: "pink", label: "Bruit rose (doux)" },
  { value: "brown", label: "Bruit brun (grave)" },
  { value: "rain", label: "Pluie" },
];

/** How long the « Tester » button previews an ambience, in ms. */
const AMBIENT_PREVIEW_MS = 3000;

const DEFAULTS: AppSettings = {
  theme: "system",
  desired_retention: 0.9,
  daily_new_limit: 20,
  daily_review_limit: 200,
  show_next_interval: true,
  openai_api_key: null,
  tts_voice: null,
  tts_speed: null,
  piper_enabled: false,
  piper_binary_path: "",
  piper_model_path: "",
  anthropic_api_key: null,
  supabase_url: null,
  supabase_anon_key: null,
  type_the_answer_enabled: false,
  confidence_rating_enabled: false,
  pre_questioning_enabled: false,
  neuro_modes_enabled: false,
  mood_checkin_enabled: false,
  movement_break_minutes: 25,
  cyclic_sighing_enabled: false,
  sketch_before_flip_enabled: false,
  delayed_jol_enabled: false,
  jol_delay_minutes: 30,
  voice_answer_enabled: false,
  pretest_mode_enabled: false,
  self_explanation_enabled: false,
  focus_guard_enabled: false,
  ollama_enabled: false,
  ollama_url: null,
  ollama_model: null,
  chronotype: null,
  ambient_sound: "none",
  hands_free_enabled: false,
};

const MIN_MINUTES = 10;
const MAX_MINUTES = 60;

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.round(value), min), max);
}

export function NeuroModesSection() {
  const query = useSettingsQuery();
  const save = useSaveSettings({
    onSuccess: () => {
      toast({ title: "Modes neuro mis à jour" });
    },
    onError: (err) => {
      toast({
        title: "Échec de la sauvegarde",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const [draft, setDraft] = useState<AppSettings>(DEFAULTS);
  // Vague 18 — chronotype quiz dialog + ambient preview controller.
  const [quizOpen, setQuizOpen] = useState(false);

  useEffect(() => {
    if (query.data) {
      setDraft(query.data);
    }
  }, [query.data]);

  // Persist a single-field patch immediately (used by the chronotype result
  // and the ambient dropdown — both act on their own, not via « Sauvegarder »).
  function persistPatch(patch: Partial<AppSettings>) {
    const base = query.data ?? DEFAULTS;
    save.mutate({ ...base, ...patch });
  }

  function handleChronotypeResult(chronotype: Chronotype) {
    setDraft((d) => ({ ...d, chronotype }));
    persistPatch({ chronotype });
  }

  function handleAmbientChange(value: AmbientKind) {
    setDraft((d) => ({ ...d, ambient_sound: value }));
    persistPatch({ ambient_sound: value });
  }

  // Preview the chosen ambience for a few seconds. Self-stopping so we never
  // leave an AudioContext running after the user leaves Settings.
  function handleTestAmbient() {
    const kind = draft.ambient_sound;
    if (kind === "none") return;
    const controller = createAmbient(kind, 0.15);
    controller.start();
    window.setTimeout(() => controller.stop(), AMBIENT_PREVIEW_MS);
  }

  const currentChronotype = (query.data?.chronotype ?? null) as Chronotype | null;

  const dirty = useMemo(() => {
    if (!query.data) return false;
    const a = query.data;
    const b = draft;
    return (
      a.neuro_modes_enabled !== b.neuro_modes_enabled ||
      a.mood_checkin_enabled !== b.mood_checkin_enabled ||
      a.movement_break_minutes !== b.movement_break_minutes ||
      a.cyclic_sighing_enabled !== b.cyclic_sighing_enabled
    );
  }, [query.data, draft]);

  function onSave() {
    save.mutate({
      ...(query.data ?? DEFAULTS),
      neuro_modes_enabled: draft.neuro_modes_enabled,
      mood_checkin_enabled: draft.mood_checkin_enabled,
      movement_break_minutes: clamp(draft.movement_break_minutes, MIN_MINUTES, MAX_MINUTES),
      cyclic_sighing_enabled: draft.cyclic_sighing_enabled,
    });
  }

  const masterOff = !draft.neuro_modes_enabled;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Modes neuro (opt-in)</CardTitle>
        <CardDescription>
          Ces fonctionnalités sont opt-in et basées sur des études scientifiques (effets modérés).
          <strong> Aucune prescription médicale.</strong>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Master switch */}
        <div className="flex items-center justify-between gap-4 rounded-md border bg-muted/30 px-4 py-3">
          <div className="space-y-0.5">
            <Label htmlFor="neuro-master" className="text-sm font-semibold">
              Activer les modes neuro
            </Label>
            <p className="text-xs text-muted-foreground">
              Désactive toutes les options ci-dessous. Réglage de l'app inchangé par défaut.
            </p>
          </div>
          <Switch
            id="neuro-master"
            data-testid="neuro-master-switch"
            checked={draft.neuro_modes_enabled}
            disabled={query.isLoading}
            onCheckedChange={(checked) => setDraft((d) => ({ ...d, neuro_modes_enabled: checked }))}
          />
        </div>

        {/* Mood/Sleep check-in */}
        <div className="flex items-center justify-between gap-4 rounded-md border bg-muted/30 px-4 py-3">
          <div className="space-y-0.5">
            <Label htmlFor="mood-checkin" className="text-sm">
              Mood / Sleep check-in pré-session
            </Label>
            <p className="text-xs text-muted-foreground">
              5 questions rapides avant chaque session (humeur, sommeil, stress, hydratation,
              caféine). g≈0.621 sur le sommeil.
            </p>
          </div>
          <Switch
            id="mood-checkin"
            data-testid="mood-checkin-switch"
            checked={draft.mood_checkin_enabled}
            disabled={query.isLoading || masterOff}
            onCheckedChange={(checked) =>
              setDraft((d) => ({ ...d, mood_checkin_enabled: checked }))
            }
          />
        </div>

        {/* Movement break interval */}
        <div className="rounded-md border bg-muted/30 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="movement-slider" className="text-sm">
              Movement break toutes les{" "}
              <span className="font-semibold text-primary">{draft.movement_break_minutes}</span> min
            </Label>
            <span className="text-xs text-muted-foreground">10–60 min</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Mini-pause de 5 min pour bouger (d≈0.52, Roig et al.).
          </p>
          <Slider
            id="movement-slider"
            data-testid="movement-slider"
            min={MIN_MINUTES}
            max={MAX_MINUTES}
            step={5}
            value={[draft.movement_break_minutes]}
            disabled={query.isLoading || masterOff}
            onValueChange={([v]) =>
              setDraft((d) => ({
                ...d,
                movement_break_minutes: typeof v === "number" ? v : d.movement_break_minutes,
              }))
            }
            className="mt-3"
          />
        </div>

        {/* Cyclic sighing primer */}
        <div className="flex items-center justify-between gap-4 rounded-md border bg-muted/30 px-4 py-3">
          <div className="space-y-0.5">
            <Label htmlFor="cyclic-sighing" className="text-sm">
              Cyclic sighing primer (5 min)
            </Label>
            <p className="text-xs text-muted-foreground">
              Proposer la séquence respiratoire quand le stress est élevé (Spiegel, Cell Reports
              Medicine 2023).
            </p>
          </div>
          <Switch
            id="cyclic-sighing"
            data-testid="cyclic-sighing-switch"
            checked={draft.cyclic_sighing_enabled}
            disabled={query.isLoading || masterOff}
            onCheckedChange={(checked) =>
              setDraft((d) => ({ ...d, cyclic_sighing_enabled: checked }))
            }
          />
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

        {/* Vague 18 — Chronotype calibration (saves immediately, independent of
            the master switch above). */}
        <div className="space-y-3 rounded-md border bg-muted/30 px-4 py-3">
          <div className="flex items-center gap-2">
            <Moon className="h-4 w-4" />
            <Label className="text-sm font-semibold">Chronotype</Label>
          </div>
          <p className="text-xs text-muted-foreground">
            Détermine si tu es plutôt du matin ou du soir pour repérer tes meilleurs créneaux
            d'étude (rMEQ, Horne &amp; Östberg).
          </p>
          {currentChronotype ? (
            <p className="text-sm" data-testid="chronotype-current">
              Tu es plutôt <strong>{CHRONOTYPE_INFO[currentChronotype].label}</strong>. Créneaux
              d'étude conseillés : <strong>{CHRONOTYPE_INFO[currentChronotype].slots}</strong>.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">Pas encore calibré.</p>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setQuizOpen(true)}
            data-testid="chronotype-calibrate"
          >
            {currentChronotype ? "Recalibrer mon chronotype" : "Calibrer mon chronotype"}
          </Button>
        </div>

        {/* Vague 18 — Context ambient sound (saves immediately on change). */}
        <div className="space-y-3 rounded-md border bg-muted/30 px-4 py-3">
          <div className="flex items-center gap-2">
            <Volume2 className="h-4 w-4" />
            <Label htmlFor="ambient-select" className="text-sm font-semibold">
              Ambiance sonore en session
            </Label>
          </div>
          <p className="text-xs text-muted-foreground">
            Un fond sonore léger pendant les révisions pour recréer un contexte stable (Godden &amp;
            Baddeley 1975). Généré localement, volume bas.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={draft.ambient_sound}
              onValueChange={(v) => handleAmbientChange(v as AmbientKind)}
              disabled={save.isPending}
            >
              <SelectTrigger
                id="ambient-select"
                data-testid="ambient-select"
                className="min-w-[12rem]"
              >
                <SelectValue placeholder="Choisir une ambiance" />
              </SelectTrigger>
              <SelectContent>
                {AMBIENT_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleTestAmbient}
              disabled={draft.ambient_sound === "none"}
              data-testid="ambient-test"
            >
              Tester (3s)
            </Button>
          </div>
        </div>
      </CardContent>

      <ChronotypeQuiz
        open={quizOpen}
        onClose={() => setQuizOpen(false)}
        onResult={handleChronotypeResult}
      />
    </Card>
  );
}
