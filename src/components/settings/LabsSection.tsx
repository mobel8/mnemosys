/**
 * Settings → "Labs" (Expérimental).
 *
 * Home of the opt-in experimental review modes that are functional but not
 * part of the core flow: sketch-before-flip, voice answer, hands-free mode
 * and the ambient soundscape. Each control persists immediately (no draft +
 * save button) via a read-merge-write against the freshest server payload so
 * fields owned by other sections are never clobbered (P040).
 *
 * The ambient « Tester (3s) » preview reuses `createAmbient` and self-stops,
 * so no AudioContext outlives the preview (we also stop on unmount).
 */

import { AlertTriangle, FlaskConical, Loader2, RotateCcw } from "lucide-react";
import { useEffect, useRef } from "react";
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
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/use-toast";
import { type AmbientController, type AmbientKind, createAmbient } from "@/lib/ambient";
import { useSaveSettings, useSettingsQuery } from "@/lib/queries";
import { DEFAULT_SETTINGS as DEFAULTS } from "@/lib/stores/settings";
import type { AppSettings } from "@/lib/tauri";

/** Ambient-sound dropdown options. */
const AMBIENT_OPTIONS: { value: AmbientKind; label: string }[] = [
  { value: "none", label: "Aucune" },
  { value: "white", label: "Bruit blanc" },
  { value: "pink", label: "Bruit rose" },
  { value: "brown", label: "Bruit brun" },
  { value: "rain", label: "Pluie" },
];

/** How long the « Tester » button previews an ambience, in ms. */
const AMBIENT_PREVIEW_MS = 3000;

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

export function LabsSection() {
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

  // Stop any running ambient preview when the section unmounts.
  const previewRef = useRef<AmbientController | null>(null);
  useEffect(() => {
    return () => {
      previewRef.current?.stop();
      previewRef.current = null;
    };
  }, []);

  /**
   * Persist a single-field patch immediately. Re-reads the freshest persisted
   * settings first so a concurrent edit from another section isn't reverted,
   * and never falls back to DEFAULTS while real data exists.
   */
  async function persistPatch(patch: Partial<AppSettings>) {
    const refreshed = await query.refetch();
    const base = refreshed.data ?? query.data ?? DEFAULTS;
    save.mutate({ ...base, ...patch });
  }

  // Until the query has succeeded, don't render the form: saving DEFAULTS
  // over real (not-yet-loaded) data would silently reset other fields.
  if (!query.isSuccess) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5 text-brand-500" />
            Expérimental
          </CardTitle>
          <CardDescription>
            Modes de révision en rodage : fonctionnels, mais susceptibles d'évoluer.
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

  const settings = query.data;
  const busy = save.isPending;

  /** Preview the chosen ambience for a few seconds, replacing any running one. */
  function handleTestAmbient() {
    const kind = settings.ambient_sound as AmbientKind;
    if (kind === "none") return;
    previewRef.current?.stop();
    const controller = createAmbient(kind, 0.15);
    previewRef.current = controller;
    controller.start();
    window.setTimeout(() => controller.stop(), AMBIENT_PREVIEW_MS);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FlaskConical className="h-5 w-5 text-brand-500" />
          Expérimental
        </CardTitle>
        <CardDescription>
          Modes de révision en rodage : fonctionnels, mais susceptibles d'évoluer. Chaque réglage
          s'enregistre immédiatement.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Sketch before flip */}
        <div className="flex items-center justify-between gap-4 rounded-md border bg-muted/30 px-4 py-3">
          <div className="space-y-0.5">
            <Label htmlFor="sketch-toggle" className="text-sm">
              Dessin avant le retournement
            </Label>
            <p className="text-xs text-muted-foreground">
              Dessiner sa réponse avant de retourner la carte.
            </p>
          </div>
          <Switch
            id="sketch-toggle"
            checked={settings.sketch_before_flip_enabled}
            disabled={busy}
            onCheckedChange={(checked) => {
              void persistPatch({ sketch_before_flip_enabled: checked });
            }}
          />
        </div>

        {/* Voice answer */}
        <div className="flex items-center justify-between gap-4 rounded-md border bg-muted/30 px-4 py-3">
          <div className="space-y-0.5">
            <Label htmlFor="voice-answer-toggle" className="text-sm">
              Réponse vocale
            </Label>
            <p className="text-xs text-muted-foreground">
              Répondre à voix haute (transcription Whisper, clé OpenAI requise).
            </p>
          </div>
          <Switch
            id="voice-answer-toggle"
            checked={settings.voice_answer_enabled}
            disabled={busy}
            onCheckedChange={(checked) => {
              void persistPatch({ voice_answer_enabled: checked });
            }}
          />
        </div>

        {/* Hands-free mode */}
        <div className="flex items-center justify-between gap-4 rounded-md border bg-muted/30 px-4 py-3">
          <div className="space-y-0.5">
            <Label htmlFor="hands-free-toggle" className="text-sm">
              Mode mains-libres
            </Label>
            <p className="text-xs text-muted-foreground">
              La session est lue à voix haute et se note à la voix.
            </p>
          </div>
          <Switch
            id="hands-free-toggle"
            checked={settings.hands_free_enabled}
            disabled={busy}
            onCheckedChange={(checked) => {
              void persistPatch({ hands_free_enabled: checked });
            }}
          />
        </div>

        {/* Ambient sound */}
        <div className="space-y-3 rounded-md border bg-muted/30 px-4 py-3">
          <div className="space-y-0.5">
            <Label htmlFor="ambient-select" className="text-sm">
              Ambiance sonore en session
            </Label>
            <p className="text-xs text-muted-foreground">
              Un fond sonore discret, généré localement, pendant les révisions.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={settings.ambient_sound}
              onValueChange={(v) => {
                void persistPatch({ ambient_sound: v as AmbientKind });
              }}
              disabled={busy}
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
              disabled={settings.ambient_sound === "none"}
              data-testid="ambient-test"
            >
              Tester (3s)
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
