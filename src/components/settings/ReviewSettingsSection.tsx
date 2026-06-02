/**
 * Settings → "Réglages des révisions".
 *
 * Surfaces the FSRS-relevant knobs (desired retention) and the daily caps
 * (new cards, reviews). Values live in `AppSettings` on the backend; we
 * hydrate via `useSettingsQuery()` and persist with `useSaveSettings()`.
 *
 * "Save" is a single bulk-write rather than per-field auto-save, mostly to
 * avoid spamming the backend while a slider is being dragged. The local
 * draft state is reset whenever a fresh server payload arrives so other
 * agents that mutate settings don't get clobbered.
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
import type { AppSettings } from "@/lib/tauri";

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
  // Vague 2 cognitive features — opt-in.
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
  // Vague 12 cognitive features — opt-in.
  pretest_mode_enabled: false,
  self_explanation_enabled: false,
  focus_guard_enabled: false,
  // Vague 18 — local AI + advanced neuro.
  ollama_enabled: false,
  ollama_url: null,
  ollama_model: null,
  chronotype: null,
  ambient_sound: "none",
  hands_free_enabled: false,
};

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
      a.confidence_rating_enabled !== b.confidence_rating_enabled ||
      a.pre_questioning_enabled !== b.pre_questioning_enabled ||
      a.sketch_before_flip_enabled !== b.sketch_before_flip_enabled ||
      a.delayed_jol_enabled !== b.delayed_jol_enabled ||
      a.voice_answer_enabled !== b.voice_answer_enabled ||
      a.pretest_mode_enabled !== b.pretest_mode_enabled ||
      a.self_explanation_enabled !== b.self_explanation_enabled ||
      a.focus_guard_enabled !== b.focus_guard_enabled ||
      a.hands_free_enabled !== b.hands_free_enabled
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
      pre_questioning_enabled: draft.pre_questioning_enabled,
      sketch_before_flip_enabled: draft.sketch_before_flip_enabled,
      delayed_jol_enabled: draft.delayed_jol_enabled,
      voice_answer_enabled: draft.voice_answer_enabled,
      pretest_mode_enabled: draft.pretest_mode_enabled,
      self_explanation_enabled: draft.self_explanation_enabled,
      focus_guard_enabled: draft.focus_guard_enabled,
      hands_free_enabled: draft.hands_free_enabled,
    });
  }

  const retentionPct = Math.round(draft.desired_retention * 100);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Réglages des révisions</CardTitle>
        <CardDescription>
          Ajuste la rétention cible et le rythme journalier. Les changements ne s'appliquent
          qu'après sauvegarde.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Desired retention */}
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="retention-slider" className="text-sm">
              Rétention cible
            </Label>
            <span className="tabular-nums text-sm font-semibold text-primary">{retentionPct}%</span>
          </div>
          <Slider
            id="retention-slider"
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
            FSRS-6 ajuste les intervalles pour viser ce taux de réussite. 90 % est un bon compromis.
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

        {/* --- Vague 2: Cognitive features ---------------------------------- */}
        <div className="space-y-3">
          <div className="text-sm font-medium text-foreground">Modes cognitifs</div>
          <div className="flex items-center justify-between gap-4 rounded-md border bg-muted/30 px-4 py-3">
            <div className="space-y-0.5">
              <Label htmlFor="type-the-answer-toggle" className="text-sm">
                Type-the-answer
              </Label>
              <p className="text-xs text-muted-foreground">
                Tape la réponse avant de retourner la carte (generation effect — Slamecka &amp; Graf
                1978, d≈0.40).
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
                Note ta confiance 1-5 avant le rating FSRS (CBM — Gardner-Medwin, UCL).
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
          <div className="flex items-center justify-between gap-4 rounded-md border bg-muted/30 px-4 py-3">
            <div className="space-y-0.5">
              <Label htmlFor="pre-questioning-toggle" className="text-sm">
                Pré-questionnement IA
              </Label>
              <p className="text-xs text-muted-foreground">
                Questions d'amorçage avant chaque nouveau bloc (g≈0.45 — Pan et al. 2023). Nécessite
                une clé Anthropic configurée.
              </p>
            </div>
            <Switch
              id="pre-questioning-toggle"
              checked={draft.pre_questioning_enabled}
              disabled={query.isLoading}
              onCheckedChange={(checked) =>
                setDraft((d) => ({ ...d, pre_questioning_enabled: checked }))
              }
            />
          </div>
          {/* --- Vague 7: Tier S — Sketch + Delayed-JOL ----------------------- */}
          <div className="flex items-center justify-between gap-4 rounded-md border bg-muted/30 px-4 py-3">
            <div className="space-y-0.5">
              <Label htmlFor="sketch-toggle" className="text-sm">
                Dessin avant flip (drawing effect)
              </Label>
              <p className="text-xs text-muted-foreground">
                Dessine ta réponse avant de retourner la carte (Wammes 2016, +30-50% rappel).
                Capture PNG stockée localement.
              </p>
            </div>
            <Switch
              id="sketch-toggle"
              checked={draft.sketch_before_flip_enabled}
              disabled={query.isLoading}
              onCheckedChange={(checked) =>
                setDraft((d) => ({ ...d, sketch_before_flip_enabled: checked }))
              }
            />
          </div>
          <div className="flex items-center justify-between gap-4 rounded-md border bg-muted/30 px-4 py-3">
            <div className="space-y-0.5">
              <Label htmlFor="jol-toggle" className="text-sm">
                Prédictions de rappel différées (JOL)
              </Label>
              <p className="text-xs text-muted-foreground">
                Prédis la chance de réussir une carte ~30 min après l'avoir vue (Rhodes &amp; Tauber
                2011, g=0.93). Affiche la calibration γ + biais dans Stats.
              </p>
            </div>
            <Switch
              id="jol-toggle"
              checked={draft.delayed_jol_enabled}
              disabled={query.isLoading}
              onCheckedChange={(checked) =>
                setDraft((d) => ({ ...d, delayed_jol_enabled: checked }))
              }
            />
          </div>
          {/* --- Vague 8: Whisper Mode Review (voice answer) ------------------ */}
          <div className="flex items-center justify-between gap-4 rounded-md border bg-muted/30 px-4 py-3">
            <div className="space-y-0.5">
              <Label htmlFor="voice-answer-toggle" className="text-sm">
                Réponse vocale (Whisper)
              </Label>
              <p className="text-xs text-muted-foreground">
                Réponds aux cartes basic à voix haute. La transcription OpenAI Whisper est comparée
                à la réponse attendue via le même scoring fuzzy que Type-the-answer. Nécessite une
                clé OpenAI configurée.
              </p>
            </div>
            <Switch
              id="voice-answer-toggle"
              checked={draft.voice_answer_enabled}
              disabled={query.isLoading}
              onCheckedChange={(checked) =>
                setDraft((d) => ({ ...d, voice_answer_enabled: checked }))
              }
            />
          </div>
          {/* --- Vague 12: Pretest + Self-explanation + Focus Guard --------- */}
          <div className="flex items-center justify-between gap-4 rounded-md border bg-muted/30 px-4 py-3">
            <div className="space-y-0.5">
              <Label htmlFor="pretest-mode-toggle" className="text-sm">
                Mode pré-test
              </Label>
              <p className="text-xs text-muted-foreground">
                Devine la réponse d'une carte neuve avant de la révéler, même en cas d'erreur
                (pretesting effect — Pan et al. 2023).
              </p>
            </div>
            <Switch
              id="pretest-mode-toggle"
              checked={draft.pretest_mode_enabled}
              disabled={query.isLoading}
              onCheckedChange={(checked) =>
                setDraft((d) => ({ ...d, pretest_mode_enabled: checked }))
              }
            />
          </div>
          <div className="flex items-center justify-between gap-4 rounded-md border bg-muted/30 px-4 py-3">
            <div className="space-y-0.5">
              <Label htmlFor="self-explanation-toggle" className="text-sm">
                Auto-explication
              </Label>
              <p className="text-xs text-muted-foreground">
                Sur ~1 carte sur 5, explique en une phrase pourquoi c'est la réponse, après le flip
                (Chi 1989, g=0.55). Texte libre, non noté.
              </p>
            </div>
            <Switch
              id="self-explanation-toggle"
              checked={draft.self_explanation_enabled}
              disabled={query.isLoading}
              onCheckedChange={(checked) =>
                setDraft((d) => ({ ...d, self_explanation_enabled: checked }))
              }
            />
          </div>
          <div className="flex items-center justify-between gap-4 rounded-md border border-warning/30 bg-warning/5 px-4 py-3">
            <div className="space-y-0.5">
              <Label htmlFor="focus-guard-toggle" className="text-sm">
                Focus Guard (webcam)
              </Label>
              <p className="text-xs text-muted-foreground">
                Détecte le décrochage d'attention via la webcam pendant une session (Hutt 2024).
                <strong className="text-foreground/80">
                  {" "}
                  100 % local : aucune image n'est enregistrée ni envoyée.
                </strong>{" "}
                Consentement demandé au premier lancement.
              </p>
            </div>
            <Switch
              id="focus-guard-toggle"
              checked={draft.focus_guard_enabled}
              disabled={query.isLoading}
              onCheckedChange={(checked) =>
                setDraft((d) => ({ ...d, focus_guard_enabled: checked }))
              }
            />
          </div>
          {/* --- Vague 23: Hands-free review (audio + voice) ---------------- */}
          <div className="flex items-center justify-between gap-4 rounded-md border bg-muted/30 px-4 py-3">
            <div className="space-y-0.5">
              <Label htmlFor="hands-free-toggle" className="text-sm">
                Mode mains-libres (audio + voix)
              </Label>
              <p className="text-xs text-muted-foreground">
                Ajoute un bouton 🎧 en session : la question est lue (TTS), tu réponds à voix haute,
                la réponse est lue, puis tu notes à la voix (« encore / difficile / bien / facile »
                via Whisper) ou via de gros boutons. Pensé pour réviser en marchant. Nécessite une
                voix TTS (OpenAI/Piper) et, pour la notation vocale, une clé OpenAI.
              </p>
            </div>
            <Switch
              id="hands-free-toggle"
              checked={draft.hands_free_enabled}
              disabled={query.isLoading}
              onCheckedChange={(checked) =>
                setDraft((d) => ({ ...d, hands_free_enabled: checked }))
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
