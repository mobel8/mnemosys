/**
 * « Capture → cartes » — transforme une capture d'écran / photo de notes en
 * flashcards. Colle (Ctrl+V), dépose ou choisis une image → OCR offline
 * (tesseract.js) → texte éditable → cartes Cloze (mot masqué par ligne) ou
 * Recto/Verso (vocabulaire « mot - définition »).
 */

import { ClipboardPaste, ImageUp, Layers, Loader2, ScanText, Sparkles, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { type OcrResult, runOcr, terminateOcr } from "@/lib/ocr";
import { useCreateNote, useDecks } from "@/lib/queries";

type CardMode = "cloze" | "basic";

interface DraftCard {
  template: "cloze" | "basic";
  fields: Record<string, string>;
  preview: string;
}

/** Longest alphabetic word on a line — the one we mask in a cloze. */
function salientWord(line: string): string | null {
  const words = line.match(/\p{L}[\p{L}\p{N}'-]{2,}/gu) ?? [];
  if (words.length === 0) return null;
  return words.reduce((a, b) => (b.length > a.length ? b : a));
}

function buildCards(lines: string[], mode: CardMode): DraftCard[] {
  if (mode === "cloze") {
    return lines
      .map((line): DraftCard | null => {
        const w = salientWord(line);
        if (!w || line.split(/\s+/).length < 2) return null;
        const text = line.replace(w, `{{c1::${w}}}`);
        return { template: "cloze", fields: { text }, preview: text };
      })
      .filter((c): c is DraftCard => c !== null);
  }
  // recto/verso : « mot - définition », « mot : définition », ou tabulation
  return lines
    .map((line): DraftCard | null => {
      const parts = line.split(/\s[-–—:]\s|\t/);
      if (parts.length < 2) return null;
      const front = parts[0]?.trim() ?? "";
      const back = parts.slice(1).join(" ").trim();
      if (!front || !back) return null;
      return { template: "basic", fields: { front, back }, preview: `${front} → ${back}` };
    })
    .filter((c): c is DraftCard => c !== null);
}

export default function CapturePage() {
  const { toast } = useToast();
  const decks = useDecks();
  const createNote = useCreateNote();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [ocr, setOcr] = useState<OcrResult | null>(null);
  const [text, setText] = useState("");
  const [mode, setMode] = useState<CardMode>("cloze");
  const [deckId, setDeckId] = useState<string>("");
  const [creating, setCreating] = useState(false);

  useEffect(() => () => void terminateOcr(), []);

  const loadFile = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      setImageUrl(reader.result as string);
      setOcr(null);
      setText("");
    };
    reader.readAsDataURL(file);
  }, []);

  // Coller une image depuis le presse-papier (Ctrl+V).
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) =>
        i.type.startsWith("image/"),
      );
      const file = item?.getAsFile();
      if (file) {
        e.preventDefault();
        loadFile(file);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [loadFile]);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files?.[0];
      if (file) loadFile(file);
    },
    [loadFile],
  );

  const runRecognition = useCallback(async () => {
    if (!imageUrl) return;
    setBusy(true);
    setProgress(0);
    try {
      const result = await runOcr(imageUrl, setProgress);
      setOcr(result);
      setText(result.text.trim());
      if (result.lines.length === 0) {
        toast({
          title: "Aucun texte détecté",
          description: "Essaie une image plus nette ou mieux contrastée.",
        });
      }
    } catch (err) {
      toast({
        title: "Échec de l'OCR",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }, [imageUrl, toast]);

  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const drafts = buildCards(lines, mode);

  const createCards = useCallback(async () => {
    const id = Number(deckId);
    if (!id || drafts.length === 0) return;
    setCreating(true);
    let ok = 0;
    try {
      for (const draft of drafts) {
        await createNote.mutateAsync({
          deckId: id,
          template: draft.template,
          fields: draft.fields,
          tags: ["capture"],
        });
        ok += 1;
      }
      toast({ title: `${ok} carte${ok > 1 ? "s" : ""} créée${ok > 1 ? "s" : ""}` });
      setImageUrl(null);
      setOcr(null);
      setText("");
    } catch (err) {
      toast({
        title: `Créées : ${ok}/${drafts.length}`,
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  }, [deckId, drafts, createNote, toast]);

  const deckList = decks.data ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <ScanText className="h-6 w-6 text-brand-500" />
          Capture → cartes
        </h1>
        <p className="text-sm text-muted-foreground">
          Colle <kbd className="rounded bg-muted px-1 font-mono text-xs">Ctrl+V</kbd>, dépose ou
          choisis une capture d'écran. Le texte est reconnu hors-ligne, puis transformé en
          flashcards.
        </p>
      </header>

      {/* Zone d'import */}
      {!imageUrl ? (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          onDrop={onDrop}
          onDragOver={(e) => e.preventDefault()}
          className="flex w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-input bg-card/50 px-6 py-16 text-center transition-colors hover:border-brand-400 hover:bg-accent/40"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-500">
            <ImageUp className="h-6 w-6" />
          </span>
          <span className="font-display text-base font-medium">Dépose une image ici</span>
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <ClipboardPaste className="h-4 w-4" /> ou colle depuis le presse-papier, ou clique pour
            parcourir
          </span>
        </button>
      ) : (
        <Card>
          <CardContent className="space-y-4 pt-6">
            <div className="overflow-hidden rounded-lg border bg-muted/30">
              <img
                src={imageUrl}
                alt="Aperçu de la capture importée"
                className="mx-auto max-h-80 w-auto object-contain"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={runRecognition} disabled={busy}>
                {busy ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Reconnaissance… {Math.round(progress * 100)}%
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    Extraire le texte (OCR)
                  </>
                )}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setImageUrl(null);
                  setOcr(null);
                  setText("");
                }}
              >
                <Trash2 className="h-4 w-4" />
                Retirer
              </Button>
            </div>
            {busy && (
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-200"
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) loadFile(file);
          e.target.value = "";
        }}
      />

      {/* Texte reconnu + génération de cartes */}
      {ocr && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Texte reconnu — relis et ajuste</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={8}
              className="font-mono text-sm"
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <span className="text-sm font-medium">Type de cartes</span>
                <Select value={mode} onValueChange={(v) => setMode(v as CardMode)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cloze">Cloze — mot masqué par ligne</SelectItem>
                    <SelectItem value="basic">Recto/Verso — « mot - définition »</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <span className="text-sm font-medium">Deck cible</span>
                <Select value={deckId} onValueChange={setDeckId} disabled={deckList.length === 0}>
                  <SelectTrigger>
                    <SelectValue
                      placeholder={deckList.length === 0 ? "Aucun deck" : "Choisir un deck"}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {deckList.map((d) => (
                      <SelectItem key={d.id} value={String(d.id)}>
                        {d.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 px-4 py-3">
              <span className="text-sm text-muted-foreground">
                <span className="font-mono font-semibold text-foreground tabular-nums">
                  {drafts.length}
                </span>{" "}
                carte{drafts.length > 1 ? "s" : ""} générée{drafts.length > 1 ? "s" : ""}
              </span>
              <Button onClick={createCards} disabled={drafts.length === 0 || !deckId || creating}>
                {creating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Layers className="h-4 w-4" />
                )}
                Créer les cartes
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
