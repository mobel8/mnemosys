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

import {
  AlertTriangle,
  AudioLines,
  Cpu,
  Key,
  Loader2,
  RotateCcw,
  Trash2,
  Volume2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
import { DEFAULT_SETTINGS as DEFAULTS } from "@/lib/stores/settings";
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

// P115 — formatage français : virgule décimale via Intl.NumberFormat('fr-FR')
// plutôt que toFixed() qui produit un point décimal anglais (« 1.5 Mio »).
const BYTE_FMT = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
const BYTE_FMT_2 = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });
function formatBytes(n: number): string {
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${BYTE_FMT.format(n / 1024)} Kio`;
  if (n < 1024 * 1024 * 1024) return `${BYTE_FMT.format(n / 1024 / 1024)} Mio`;
  return `${BYTE_FMT_2.format(n / 1024 / 1024 / 1024)} Gio`;
}

/**
 * P108 — états de chargement / d'erreur harmonisés pour les sections de
 * réglages adossées à `useSettingsQuery`. Tant que la requête n'a pas réussi,
 * on n'affiche pas le formulaire : le remplir avec les valeurs par défaut puis
 * sauvegarder écraserait silencieusement la configuration serveur.
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

  // Hydrate local state from the backend exactly once, on first arrival.
  // Re-running on every `query.data` change would clobber the user's
  // in-progress edits whenever another section saves and invalidates the
  // shared settings query (lost-update, P040). After the initial hydration
  // the form is user-owned; `handleSave` re-reads fresh server data so other
  // sections' fields are never overwritten.
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current || !query.data) return;
    hydratedRef.current = true;
    const s = query.data;
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
    // Re-read the freshest persisted settings right before composing the
    // payload so fields owned by other sections (theme, FSRS knobs, neuro
    // modes…) are preserved even if they changed since we hydrated. Never
    // fall back to DEFAULTS while real data exists — that would silently
    // reset every untouched field.
    const refreshed = await query.refetch();
    const current = refreshed.data ?? query.data ?? DEFAULTS;
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

  // P108 — tant que la requête n'a pas réussi, on n'affiche pas le formulaire :
  // le remplir avec les DEFAULTS puis sauvegarder écraserait la config serveur.
  if (!query.isSuccess) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Intégrations</CardTitle>
          <CardDescription>
            Configure les clés API utilisées par les fonctionnalités IA et audio. Les clés sont
            stockées localement dans <code>settings.json</code>.
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
              <p className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                {/* P110 — icône lucide en flux plutôt qu'un emoji brut. */}
                Utilisée par le bouton
                <Volume2 className="inline h-3.5 w-3.5" aria-label="lecture audio" />
                dans les cartes.
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
                aria-label="Vitesse de synthèse vocale"
                aria-valuetext={`${speed.toFixed(2)} ×`}
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
            Une fois activé, le bouton de lecture audio des cartes utilise Piper au lieu d'OpenAI.
          </p>
          <div className="flex items-center justify-between gap-4 rounded-md border bg-muted/30 px-4 py-3">
            <div className="space-y-0.5">
              <Label htmlFor="piper-enabled" className="text-sm">
                Activer la synthèse vocale locale
              </Label>
              <p className="text-xs text-muted-foreground">
                Route le bouton de lecture audio vers Piper. Sans modèle valide, la lecture affiche
                une erreur claire.
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
