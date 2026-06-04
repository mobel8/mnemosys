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

import { AlertTriangle, Loader2, Moon, RotateCcw, Save, Volume2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { DEFAULT_SETTINGS as DEFAULTS } from "@/lib/stores/settings";
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

const MIN_MINUTES = 10;
const MAX_MINUTES = 60;

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.round(value), min), max);
}

/**
 * P108 — états de chargement / d'erreur harmonisés (mêmes motifs que les autres
 * sections de réglages). Tant que la requête n'a pas réussi, on n'affiche pas le
 * formulaire : le remplir avec les valeurs par défaut puis sauvegarder
 * écraserait silencieusement la configuration serveur.
 */
function SettingsSkeleton() {
  return (
    <div
      className="space-y-4"
      role="status"
      aria-busy="true"
      aria-label="Chargement des paramètres"
    >
      <div className="h-9 w-1/2 animate-pulse rounded-lg bg-muted" />
      <div className="h-20 w-full animate-pulse rounded-lg bg-muted" />
      <div className="h-9 w-2/3 animate-pulse rounded-lg bg-muted" />
    </div>
  );
}

function SettingsErrorBanner({
  message,
  onRetry,
  isRetrying,
}: {
  message: string;
  onRetry: () => void;
  isRetrying: boolean;
}) {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm"
    >
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
      <div className="flex-1 space-y-2">
        <div>
          <p className="font-medium text-destructive">Impossible de charger les paramètres</p>
          <p className="mt-0.5 text-muted-foreground">{message}</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onRetry} disabled={isRetrying}>
          {isRetrying ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RotateCcw className="h-4 w-4" />
          )}
          Réessayer
        </Button>
      </div>
    </div>
  );
}

export function NeuroModesSection() {
  const query = useSettingsQuery();
  // P111 — la carte mêle deux paradigmes : le bloc « modes neuro » est un
  // brouillon validé par le bouton « Sauvegarder », tandis que le chronotype et
  // l'ambiance s'enregistrent immédiatement. On distingue les deux dans le toast
  // de succès pour que le lien action→résultat reste lisible.
  const autoSaveRef = useRef(false);
  const save = useSaveSettings({
    onSuccess: () => {
      toast({
        title: autoSaveRef.current ? "Enregistré automatiquement" : "Modes neuro mis à jour",
      });
      autoSaveRef.current = false;
    },
    onError: (err) => {
      autoSaveRef.current = false;
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

  // Re-sync the draft from the server when fresh settings arrive — but never
  // while the user has unsaved edits, or another section's save (which
  // invalidates the shared settings query) would clobber them (lost-update,
  // P040). On a clean draft, picking up new server values is desirable so the
  // non-neuro fields stay current.
  useEffect(() => {
    if (query.data && !dirty) {
      setDraft(query.data);
    }
  }, [query.data, dirty]);

  // Persist a single-field patch immediately (used by the chronotype result
  // and the ambient dropdown — both act on their own, not via « Sauvegarder »).
  // Re-reads the freshest persisted settings first so a concurrent edit from
  // another section isn't reverted, and never falls back to DEFAULTS while
  // real data exists.
  async function persistPatch(patch: Partial<AppSettings>) {
    const refreshed = await query.refetch();
    const base = refreshed.data ?? query.data ?? DEFAULTS;
    // P111 — flag this write as an auto-save so onSuccess shows the right toast.
    autoSaveRef.current = true;
    save.mutate({ ...base, ...patch });
  }

  function handleChronotypeResult(chronotype: Chronotype) {
    setDraft((d) => ({ ...d, chronotype }));
    void persistPatch({ chronotype });
  }

  function handleAmbientChange(value: AmbientKind) {
    setDraft((d) => ({ ...d, ambient_sound: value }));
    void persistPatch({ ambient_sound: value });
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

  async function onSave() {
    // Re-read fresh persisted settings before composing the payload so fields
    // owned by other sections survive, and never fall back to DEFAULTS while
    // real data exists.
    const refreshed = await query.refetch();
    save.mutate({
      ...(refreshed.data ?? query.data ?? DEFAULTS),
      neuro_modes_enabled: draft.neuro_modes_enabled,
      mood_checkin_enabled: draft.mood_checkin_enabled,
      movement_break_minutes: clamp(draft.movement_break_minutes, MIN_MINUTES, MAX_MINUTES),
      cyclic_sighing_enabled: draft.cyclic_sighing_enabled,
    });
  }

  const masterOff = !draft.neuro_modes_enabled;

  // P108 — tant que la requête n'a pas réussi, on n'affiche pas le formulaire :
  // le remplir avec les DEFAULTS puis sauvegarder écraserait la config serveur.
  if (!query.isSuccess) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Modes neuro (opt-in)</CardTitle>
          <CardDescription>
            Ces fonctionnalités sont opt-in et basées sur des études scientifiques (effets modérés).
            <strong> Aucune prescription médicale.</strong>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {query.isError ? (
            <SettingsErrorBanner
              message={query.error.message}
              onRetry={() => {
                void query.refetch();
              }}
              isRetrying={query.isFetching}
            />
          ) : (
            <SettingsSkeleton />
          )}
        </CardContent>
      </Card>
    );
  }

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

        {/* Mood/Sleep check-in. P111 — le bloc entier (libellé+description+contrôle)
            est atténué quand le master switch est éteint, pas seulement le Switch. */}
        <div
          className={`flex items-center justify-between gap-4 rounded-md border bg-muted/30 px-4 py-3 transition-opacity ${masterOff ? "opacity-60" : ""}`}
        >
          <div className="space-y-0.5">
            <Label htmlFor="mood-checkin" className="text-sm">
              Bilan humeur / sommeil avant la session
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

        {/* Movement break interval. P111 — bloc atténué quand master off. */}
        <div
          className={`rounded-md border bg-muted/30 px-4 py-3 transition-opacity ${masterOff ? "opacity-60" : ""}`}
        >
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="movement-slider" className="text-sm">
              Pause mouvement toutes les{" "}
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
            aria-label="Intervalle des pauses mouvement (minutes)"
            aria-valuetext={`${draft.movement_break_minutes} min`}
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

        {/* Cyclic sighing primer. P111 — bloc atténué quand master off. */}
        <div
          className={`flex items-center justify-between gap-4 rounded-md border bg-muted/30 px-4 py-3 transition-opacity ${masterOff ? "opacity-60" : ""}`}
        >
          <div className="space-y-0.5">
            <Label htmlFor="cyclic-sighing" className="text-sm">
              Amorçage par soupirs cycliques (5 min)
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
          <Button
            onClick={() => {
              void onSave();
            }}
            disabled={!dirty || save.isPending}
          >
            {save.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Sauvegarder
          </Button>
        </div>

        {/* P111 — séparateur explicite : tout ce qui suit s'enregistre
            immédiatement, sans passer par le bouton « Sauvegarder » ci-dessus. */}
        <div className="flex items-center gap-3 border-t pt-4">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Enregistré automatiquement
          </span>
          <span className="h-px flex-1 bg-border" />
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
