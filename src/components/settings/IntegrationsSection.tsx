/**
 * Settings → "Intégrations". Houses every third-party knob:
 *   - Anthropic API key (Claude — AI card generation).
 *   - OpenAI API key (TTS).
 *   - Default TTS voice + speed.
 *   - TTS cache size + clear-cache action.
 *
 * Persistence: every key/value is mirrored into the `AppSettings` blob via
 * `useSaveSettings`. Keys are kept as plain text in the settings.json store
 * for the MVP; Session 3+ will migrate them to the OS keychain.
 */

import { Key, Loader2, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { toast } from "@/components/ui/use-toast";
import {
  useClearTtsCache,
  useSaveSettings,
  useSettingsQuery,
  useTtsCacheSize,
} from "@/lib/queries";
import type { AppSettings, TTSVoice } from "@/lib/tauri";

const VOICES: { value: TTSVoice; label: string }[] = [
  { value: "nova", label: "Nova (féminine, neutre)" },
  { value: "alloy", label: "Alloy (mixte)" },
  { value: "echo", label: "Echo (masculine)" },
  { value: "fable", label: "Fable (britannique)" },
  { value: "onyx", label: "Onyx (masculine, grave)" },
  { value: "shimmer", label: "Shimmer (féminine, douce)" },
  { value: "coral", label: "Coral (féminine, énergique)" },
  { value: "sage", label: "Sage (mixte, posée)" },
];

const SPEED_MIN = 0.5;
const SPEED_MAX = 2.0;
const SPEED_STEP = 0.05;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} Kio`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} Mio`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} Gio`;
}

const DEFAULTS: AppSettings = {
  theme: "system",
  desired_retention: 0.9,
  daily_new_limit: 20,
  daily_review_limit: 200,
  show_next_interval: true,
  openai_api_key: null,
  tts_voice: null,
  tts_speed: null,
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
};

export function IntegrationsSection() {
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

  const cacheSizeQuery = useTtsCacheSize();
  const clearCache = useClearTtsCache({
    onSuccess: () => {
      toast({ title: "Cache TTS vidé" });
    },
    onError: (err) => {
      toast({
        title: "Impossible de vider le cache",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const [anthropic, setAnthropic] = useState("");
  const [openai, setOpenai] = useState("");
  const [voice, setVoice] = useState<TTSVoice>("nova");
  const [speed, setSpeed] = useState(1.0);

  // Hydrate local state once settings arrive from the backend.
  useEffect(() => {
    const s = query.data ?? DEFAULTS;
    setAnthropic(s.anthropic_api_key ?? "");
    setOpenai(s.openai_api_key ?? "");
    setVoice(((s.tts_voice as TTSVoice | null) ?? "nova") as TTSVoice);
    setSpeed(s.tts_speed ?? 1.0);
  }, [query.data]);

  async function handleSave() {
    const current = query.data ?? DEFAULTS;
    const next: AppSettings = {
      ...current,
      anthropic_api_key: anthropic.trim() === "" ? null : anthropic.trim(),
      openai_api_key: openai.trim() === "" ? null : openai.trim(),
      tts_voice: voice,
      tts_speed: speed,
    };
    save.mutate(next);
  }

  const cacheBytes = cacheSizeQuery.data ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Intégrations</CardTitle>
        <CardDescription>
          Configure les clés API utilisées par les fonctionnalités IA et audio. Les clés sont
          stockées localement dans <code>settings.json</code>. Tu peux aussi définir les variables
          d'environnement <code>ANTHROPIC_API_KEY</code> et <code>OPENAI_API_KEY</code>, qui ont la
          priorité.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-8">
        {/* ---- API keys ---- */}
        <section className="space-y-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Key className="h-4 w-4" />
            Clés API
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="anthropic-key">Anthropic (Claude — génération IA)</Label>
              <Input
                id="anthropic-key"
                type="password"
                autoComplete="off"
                placeholder="sk-ant-…"
                value={anthropic}
                onChange={(e) => setAnthropic(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Utilisée par la page <strong>Génération IA</strong>.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="openai-key">OpenAI (TTS — synthèse vocale)</Label>
              <Input
                id="openai-key"
                type="password"
                autoComplete="off"
                placeholder="sk-…"
                value={openai}
                onChange={(e) => setOpenai(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Utilisée par le bouton 🔊 dans les cartes.
              </p>
            </div>
          </div>
        </section>

        {/* ---- TTS defaults ---- */}
        <section className="space-y-4">
          <h3 className="text-sm font-semibold">Synthèse vocale (TTS)</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="tts-voice">Voix par défaut</Label>
              <select
                id="tts-voice"
                value={voice}
                onChange={(e) => setVoice(e.target.value as TTSVoice)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {VOICES.map((v) => (
                  <option key={v.value} value={v.value}>
                    {v.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tts-speed">
                Vitesse : <span className="font-mono">{speed.toFixed(2)}×</span>
              </Label>
              <Slider
                id="tts-speed"
                value={[speed]}
                min={SPEED_MIN}
                max={SPEED_MAX}
                step={SPEED_STEP}
                onValueChange={(value) => setSpeed(value[0] ?? 1.0)}
              />
            </div>
          </div>
        </section>

        {/* ---- TTS cache ---- */}
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Cache TTS</h3>
          <p className="text-sm text-muted-foreground">
            Les fichiers audio synthétisés sont conservés sur disque pour éviter de re-payer la même
            phrase. Taille actuelle :{" "}
            <strong className="font-mono">{formatBytes(cacheBytes)}</strong>.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => clearCache.mutate()}
            disabled={clearCache.isPending || cacheBytes === 0}
          >
            {clearCache.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            Vider le cache
          </Button>
        </section>

        <div className="flex justify-end gap-2 border-t pt-4">
          <Button
            type="button"
            onClick={() => {
              void handleSave();
            }}
            disabled={save.isPending}
          >
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Enregistrer
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
