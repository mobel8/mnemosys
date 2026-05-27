/**
 * Deck Podcast generation dialog (Vague 8 — NotebookLM-style).
 *
 * Lets the learner generate a 2-voice podcast of an entire deck's content:
 *   - Pick a format (DeepDive / Brief / Critique).
 *   - Pick a Host voice + Expert voice from the 8 OpenAI TTS voices.
 *   - Click "Générer" → ~30-60 s round-trip (script via Claude, audio via
 *     OpenAI TTS), result plays inline.
 *   - The list of previously generated podcasts for this deck is rendered
 *     below the generator so the learner can replay or delete them.
 *
 * Implementation notes:
 *   - The generated MP3 lives in `<app_cache_dir>/podcasts/`. We rely on
 *     Tauri's `convertFileSrc()` to expose it to the WebView via the
 *     `asset://` protocol.
 *   - "Download" copies the cached file to a user-chosen destination via
 *     the dialog plugin (save dialog) + plugin-fs (writeBinary). We don't
 *     re-stream the bytes from the backend — they are already on disk.
 */

import { convertFileSrc } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { copyFile } from "@tauri-apps/plugin-fs";
import { Download, Loader2, Mic2, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
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
import { toast } from "@/components/ui/use-toast";
import { useDeletePodcast, useGenerateDeckPodcast, useListDeckPodcasts } from "@/lib/queries";
import type { PodcastFile, PodcastFormat, TTSVoice } from "@/lib/tauri";
import { cn } from "@/lib/utils";

interface DeckPodcastDialogProps {
  deckId: number;
  deckName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const FORMATS: { value: PodcastFormat; label: string; description: string }[] = [
  {
    value: "deep_dive",
    label: "Deep Dive",
    description: "Épisode détaillé ~5 min, l'experte explique chaque carte avec exemples.",
  },
  {
    value: "brief",
    label: "Brief",
    description: "Highlight reel ~2 min, uniquement les cartes phares.",
  },
  {
    value: "critique",
    label: "Critique",
    description: "Débat critique : l'animateur challenge chaque affirmation.",
  },
];

const VOICES: { value: TTSVoice; label: string }[] = [
  { value: "nova", label: "Nova (féminine)" },
  { value: "alloy", label: "Alloy (mixte)" },
  { value: "echo", label: "Echo (masculine)" },
  { value: "fable", label: "Fable (UK)" },
  { value: "onyx", label: "Onyx (grave)" },
  { value: "shimmer", label: "Shimmer (douce)" },
  { value: "coral", label: "Coral (énergique)" },
  { value: "sage", label: "Sage (posée)" },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Kio`;
  return `${(bytes / 1024 / 1024).toFixed(1)} Mio`;
}

function formatGeneratedAt(unixSeconds: number): string {
  if (!unixSeconds || !Number.isFinite(unixSeconds)) return "—";
  return new Date(unixSeconds * 1000).toLocaleString("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function basename(path: string): string {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return idx >= 0 ? path.slice(idx + 1) : path;
}

export function DeckPodcastDialog({
  deckId,
  deckName,
  open,
  onOpenChange,
}: DeckPodcastDialogProps) {
  const [format, setFormat] = useState<PodcastFormat>("deep_dive");
  const [hostVoice, setHostVoice] = useState<TTSVoice>("nova");
  const [expertVoice, setExpertVoice] = useState<TTSVoice>("onyx");
  const [latestPath, setLatestPath] = useState<string | null>(null);

  const listQuery = useListDeckPodcasts(deckId, { enabled: open });
  const generate = useGenerateDeckPodcast({
    onSuccess: (result) => {
      setLatestPath(result.path);
      toast({
        title: result.cached ? "Podcast déjà en cache" : "Podcast généré",
        description: result.cached
          ? "Récupéré depuis le cache local."
          : `${result.line_count} répliques • ≈${result.duration_estimate_seconds} s.`,
      });
    },
    onError: (err) => {
      const message = err.message ?? "Erreur inconnue";
      const isMissingKey = /api key/i.test(message);
      toast({
        title: isMissingKey ? "Clés API manquantes" : "Génération impossible",
        description: isMissingKey
          ? "Configure les clés Anthropic et OpenAI dans Settings."
          : message,
        variant: "destructive",
      });
    },
  });
  const deletePodcast = useDeletePodcast({
    onSuccess: (_data, variables) => {
      toast({ title: "Podcast supprimé" });
      if (latestPath === variables.path) setLatestPath(null);
    },
    onError: (err) => {
      toast({
        title: "Suppression impossible",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const sameVoice = hostVoice === expertVoice;
  const canGenerate = !generate.isPending && !sameVoice;

  function onGenerate() {
    if (!canGenerate) return;
    generate.mutate({
      deckId,
      format,
      hostVoice,
      expertVoice,
      language: "fr",
    });
  }

  async function onDownload(path: string) {
    try {
      const suggested = basename(path);
      const dest = await save({
        defaultPath: suggested,
        filters: [{ name: "Podcast MP3", extensions: ["mp3"] }],
      });
      if (!dest) return;
      await copyFile(path, dest);
      toast({ title: "Téléchargement terminé", description: dest });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast({
        title: "Téléchargement impossible",
        description: message,
        variant: "destructive",
      });
    }
  }

  const podcasts: PodcastFile[] = useMemo(() => listQuery.data ?? [], [listQuery.data]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mic2 className="h-5 w-5" />
            Générer un podcast pour « {deckName} »
          </DialogTitle>
          <DialogDescription>
            Transforme ce deck en un dialogue audio entre un animateur et une experte. Nécessite des
            clés Anthropic et OpenAI configurées.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Format picker */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Format</Label>
            <div
              role="radiogroup"
              aria-label="Format du podcast"
              className="grid gap-2 sm:grid-cols-3"
            >
              {FORMATS.map((f) => {
                const isSelected = format === f.value;
                return (
                  // biome-ignore lint/a11y/useSemanticElements: visual radio "card" — a real <input type="radio"> can't render the multi-line content + description, and the WAI-ARIA radiogroup role pattern is the documented alternative.
                  <button
                    key={f.value}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => setFormat(f.value)}
                    className={cn(
                      "flex flex-col items-start gap-1 rounded-md border px-3 py-2 text-left transition-colors",
                      isSelected ? "border-primary bg-primary/5" : "border-input hover:bg-muted/50",
                    )}
                  >
                    <span className="text-sm font-medium">{f.label}</span>
                    <span className="text-xs text-muted-foreground">{f.description}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Voice pickers */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="host-voice">Voix Host (animateur)</Label>
              <select
                id="host-voice"
                value={hostVoice}
                onChange={(e) => setHostVoice(e.target.value as TTSVoice)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {VOICES.map((v) => (
                  <option key={v.value} value={v.value}>
                    {v.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="expert-voice">Voix Expert (experte)</Label>
              <select
                id="expert-voice"
                value={expertVoice}
                onChange={(e) => setExpertVoice(e.target.value as TTSVoice)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {VOICES.map((v) => (
                  <option key={v.value} value={v.value}>
                    {v.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {sameVoice && (
            <p className="text-xs text-destructive">
              Choisis deux voix différentes pour bien distinguer Host et Expert.
            </p>
          )}

          <div className="flex justify-end">
            <Button onClick={onGenerate} disabled={!canGenerate} aria-label="Générer le podcast">
              {generate.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Mic2 className="h-4 w-4" />
              )}
              {generate.isPending ? "Génération…" : "Générer"}
            </Button>
          </div>

          {/* Latest result inline player */}
          {latestPath && (
            <div className="space-y-2 rounded-md border bg-muted/30 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">Dernier épisode</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void onDownload(latestPath);
                  }}
                >
                  <Download className="h-4 w-4" />
                  Télécharger
                </Button>
              </div>
              {/** biome-ignore lint/a11y/useMediaCaption: generated podcast audio — no caption track available. */}
              <audio
                controls
                preload="metadata"
                src={convertFileSrc(latestPath)}
                className="w-full"
              />
            </div>
          )}

          {/* Existing podcasts list */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Épisodes précédents</Label>
            {listQuery.isLoading ? (
              <p className="text-xs text-muted-foreground">Chargement…</p>
            ) : podcasts.length === 0 ? (
              <p className="text-xs text-muted-foreground">Aucun podcast généré pour ce deck.</p>
            ) : (
              <ul className="space-y-2">
                {podcasts.map((p) => (
                  <li
                    key={p.path}
                    className="rounded-md border bg-background p-3"
                    data-testid="podcast-list-item"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium" title={basename(p.path)}>
                          {basename(p.path)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatGeneratedAt(p.generated_at)} • {formatBytes(p.size_bytes)}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          aria-label="Télécharger"
                          onClick={() => {
                            void onDownload(p.path);
                          }}
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          aria-label="Supprimer"
                          onClick={() => deletePodcast.mutate({ path: p.path, deckId })}
                          disabled={deletePodcast.isPending}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    {/** biome-ignore lint/a11y/useMediaCaption: see above — no caption track. */}
                    <audio
                      controls
                      preload="none"
                      src={convertFileSrc(p.path)}
                      className="mt-2 w-full"
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Fermer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
