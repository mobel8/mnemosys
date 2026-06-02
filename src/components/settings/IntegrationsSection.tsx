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

import { AudioLines, Cpu, Key, Loader2, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
  // Vague 18 — local AI (Ollama) config.
  const [ollamaEnabled, setOllamaEnabled] = useState(false);
  const [ollamaUrl, setOllamaUrl] = useState("");
  const [ollamaModel, setOllamaModel] = useState("");
  // Vague 22 — local TTS (Piper) config.
  const [piperEnabled, setPiperEnabled] = useState(false);
  const [piperBinary, setPiperBinary] = useState("");
  const [piperModel, setPiperModel] = useState("");

  // Hydrate local state once settings arrive from the backend.
  useEffect(() => {
    const s = query.data ?? DEFAULTS;
    setAnthropic(s.anthropic_api_key ?? "");
    setOpenai(s.openai_api_key ?? "");
    setVoice(((s.tts_voice as TTSVoice | null) ?? "nova") as TTSVoice);
    setSpeed(s.tts_speed ?? 1.0);
    setOllamaEnabled(s.ollama_enabled);
    setOllamaUrl(s.ollama_url ?? "");
    setOllamaModel(s.ollama_model ?? "");
    setPiperEnabled(s.piper_enabled);
    setPiperBinary(s.piper_binary_path ?? "");
    setPiperModel(s.piper_model_path ?? "");
  }, [query.data]);

  async function handleSave() {
    const current = query.data ?? DEFAULTS;
    const next: AppSettings = {
      ...current,
      anthropic_api_key: anthropic.trim() === "" ? null : anthropic.trim(),
      openai_api_key: openai.trim() === "" ? null : openai.trim(),
      tts_voice: voice,
      tts_speed: speed,
      ollama_enabled: ollamaEnabled,
      ollama_url: ollamaUrl.trim() === "" ? null : ollamaUrl.trim(),
      ollama_model: ollamaModel.trim() === "" ? null : ollamaModel.trim(),
      piper_enabled: piperEnabled,
      piper_binary_path: piperBinary.trim(),
      piper_model_path: piperModel.trim(),
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

        {/* ---- Local AI (Ollama) ---- */}
        <section className="space-y-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Cpu className="h-4 w-4" />
            IA locale (Ollama)
          </h3>
          <p className="text-sm text-muted-foreground">
            Génère des cartes avec un LLM tournant sur ta machine — aucune donnée envoyée, zéro coût
            API. Installe Ollama (<code>ollama.com</code>) puis lance{" "}
            <code>ollama pull llama3.2</code>. Active ensuite « IA locale » sur la page Génération
            IA.
          </p>
          <div className="flex items-center justify-between gap-4 rounded-md border bg-muted/30 px-4 py-3">
            <div className="space-y-0.5">
              <Label htmlFor="ollama-enabled" className="text-sm">
                Activer l'IA locale par défaut
              </Label>
              <p className="text-xs text-muted-foreground">
                Pré-coche le mode local sur la page Génération IA (modifiable carte par carte).
              </p>
            </div>
            <Switch
              id="ollama-enabled"
              data-testid="ollama-enabled-switch"
              checked={ollamaEnabled}
              onCheckedChange={setOllamaEnabled}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ollama-url">URL du serveur Ollama</Label>
              <Input
                id="ollama-url"
                type="text"
                autoComplete="off"
                placeholder="http://localhost:11434"
                value={ollamaUrl}
                onChange={(e) => setOllamaUrl(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Vide = <code>http://localhost:11434</code>.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ollama-model">Modèle</Label>
              <Input
                id="ollama-model"
                type="text"
                autoComplete="off"
                placeholder="llama3.2"
                value={ollamaModel}
                onChange={(e) => setOllamaModel(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Vide = <code>llama3.2</code>. Doit être téléchargé via <code>ollama pull</code>.
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
              <Select value={voice} onValueChange={(v) => setVoice(v as TTSVoice)}>
                <SelectTrigger id="tts-voice">
                  <SelectValue placeholder="Choisir une voix" />
                </SelectTrigger>
                <SelectContent>
                  {VOICES.map((v) => (
                    <SelectItem key={v.value} value={v.value}>
                      {v.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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

        {/* ---- Local TTS (Piper) ---- */}
        <section className="space-y-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <AudioLines className="h-4 w-4" />
            TTS local (Piper)
          </h3>
          <p className="text-sm text-muted-foreground">
            Synthèse vocale entièrement hors-ligne, gratuite et privée — aucune donnée envoyée.
            Télécharge le binaire <strong>Piper</strong> et un modèle de voix (<code>.onnx</code>)
            sur <code>github.com/OHF-Voice/piper1-gpl</code>, puis indique leurs chemins ci-dessous.
            Une fois activé, le bouton 🔊 des cartes utilise Piper au lieu d'OpenAI.
          </p>
          <div className="flex items-center justify-between gap-4 rounded-md border bg-muted/30 px-4 py-3">
            <div className="space-y-0.5">
              <Label htmlFor="piper-enabled" className="text-sm">
                Activer la synthèse vocale locale
              </Label>
              <p className="text-xs text-muted-foreground">
                Route le bouton 🔊 vers Piper. Sans modèle valide, la lecture affiche une erreur
                claire.
              </p>
            </div>
            <Switch
              id="piper-enabled"
              data-testid="piper-enabled-switch"
              checked={piperEnabled}
              onCheckedChange={setPiperEnabled}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="piper-binary">Chemin du binaire Piper</Label>
              <Input
                id="piper-binary"
                type="text"
                autoComplete="off"
                placeholder="piper"
                value={piperBinary}
                onChange={(e) => setPiperBinary(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Vide = <code>piper</code> (cherché dans le <code>PATH</code>).
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="piper-model">Chemin du modèle de voix (.onnx)</Label>
              <Input
                id="piper-model"
                type="text"
                autoComplete="off"
                placeholder="/chemin/vers/fr_FR-siwis-medium.onnx"
                value={piperModel}
                onChange={(e) => setPiperModel(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Obligatoire : télécharge une voix <code>.onnx</code> et pointe vers elle.
              </p>
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
