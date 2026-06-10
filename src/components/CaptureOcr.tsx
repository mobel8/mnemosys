/**
 * « Capture OCR » — transforme une capture d'écran / photo de notes en
 * flashcards. Colle (Ctrl+V), dépose ou choisis une image → OCR offline
 * (tesseract.js) → texte éditable → cartes Cloze (mot masqué par ligne) ou
 * Recto/Verso (vocabulaire « mot - définition »).
 *
 * Rendered as a tab of the « Créer » hub (`src/routes/create.page.tsx`),
 * which owns the page header — this component renders content only. Keep it
 * lazy-loaded from the hub: it drags in the tesseract.js WASM engine.
 */

import { ClipboardPaste, ImageUp, Layers, Loader2, ScanText, Trash2 } from "lucide-react";
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
import {
  DEFAULT_OCR_LANG,
  OCR_LANGUAGES,
  type OcrLang,
  type OcrResult,
  runOcr,
  terminateOcr,
} from "@/lib/ocr";
import { useCreateNote, useDecks } from "@/lib/queries";

type CardMode = "cloze" | "basic";

interface DraftCard {
  template: "cloze" | "basic";
  fields: Record<string, string>;
  preview: string;
  /**
   * Source line this draft was built from. Kept so that, on a partial
   * creation failure, we can rebuild the editable text with only the lines
   * whose cards weren't persisted — re-clicking « Créer » then retries the
   * failures without duplicating the cards that already succeeded.
   */
  sourceLine: string;
}

/**
 * Longest alphabetic word on a line — the one we mask in a cloze. Returns the
 * word **and its byte offset** in the line so the caller can splice it back in
 * by position rather than via an un-anchored `String.replace`, which would mask
 * the first *substring* match (e.g. "at" hiding inside "cat").
 */
function salientWord(line: string): { word: string; index: number } | null {
  const re = /\p{L}[\p{L}\p{N}'-]{2,}/gu;
  let best: { word: string; index: number } | null = null;
  let match: RegExpExecArray | null = re.exec(line);
  while (match !== null) {
    const word = match[0];
    // Strict `>` keeps the FIRST occurrence on a length tie.
    if (best === null || word.length > best.word.length) {
      best = { word, index: match.index };
    }
    match = re.exec(line);
  }
  return best;
}

function buildCards(lines: string[], mode: CardMode): DraftCard[] {
  if (mode === "cloze") {
    return lines
      .map((line): DraftCard | null => {
        const salient = salientWord(line);
        if (!salient || line.split(/\s+/).length < 2) return null;
        const { word, index } = salient;
        // Splice by exact index so only the chosen token is masked, even when
        // it also appears as a substring of another word on the line.
        const text = `${line.slice(0, index)}{{c1::${word}}}${line.slice(index + word.length)}`;
        return { template: "cloze", fields: { text }, preview: text, sourceLine: line };
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
      return {
        template: "basic",
        fields: { front, back },
        preview: `${front} → ${back}`,
        sourceLine: line,
      };
    })
    .filter((c): c is DraftCard => c !== null);
}

export default function CaptureOcr() {
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
  const [ocrLang, setOcrLang] = useState<OcrLang>(DEFAULT_OCR_LANG);
  const [creating, setCreating] = useState(false);

  // Guards state updates / toasts that resolve after the component unmounts
  // (e.g. the user switches tab while an OCR recognition is still in flight).
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      void terminateOcr();
    };
  }, []);

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
      // Scope progress updates to a mounted component — the OCR run can resolve
      // after the tab unmounts.
      const result = await runOcr(
        imageUrl,
        (p) => {
          if (mountedRef.current) setProgress(p);
        },
        ocrLang,
      );
      // Bail out silently if we unmounted while recognition was running:
      // touching state or toasting now would warn / leak.
      if (!mountedRef.current) return;
      setOcr(result);
      setText(result.text.trim());
      if (result.lang !== ocrLang) {
        // Requested language data wasn't available — recognition used English.
        toast({
          title: "Langue de secours utilisée",
          description:
            "Les données françaises ne sont pas installées : reconnaissance effectuée en anglais.",
        });
      }
      if (result.lines.length === 0) {
        toast({
          title: "Aucun texte détecté",
          description: "Essaie une image plus nette ou mieux contrastée.",
        });
      }
    } catch (err) {
      if (!mountedRef.current) return;
      toast({
        title: "Échec de l'OCR",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }, [imageUrl, toast, ocrLang]);

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
    // Lines whose card failed to persist — kept so a retry only re-creates
    // those, never the ones that already succeeded (would otherwise duplicate).
    const failedLines: string[] = [];
    let lastError: unknown = null;
    try {
      // Resilient loop: a single failure no longer aborts the batch. We catch
      // per card, keep going, and aggregate the outcome at the end (mirrors
      // AiGenerator.handleCreateAll).
      for (const draft of drafts) {
        try {
          await createNote.mutateAsync({
            deckId: id,
            template: draft.template,
            fields: draft.fields,
            tags: ["capture"],
          });
          ok += 1;
        } catch (err) {
          failedLines.push(draft.sourceLine);
          lastError = err;
        }
      }
    } finally {
      setCreating(false);
    }

    if (failedLines.length === 0) {
      // Full success — clear everything so the user starts fresh.
      toast({ title: `${ok} carte${ok > 1 ? "s" : ""} créée${ok > 1 ? "s" : ""}` });
      setImageUrl(null);
      setOcr(null);
      setText("");
      return;
    }

    // Partial (or total) failure. Shrink the editable text down to the lines
    // that failed so re-clicking « Créer » retries only those — the already
    // persisted cards won't be recreated.
    const remaining = failedLines.join("\n");
    setText(remaining);
    if (ok > 0) {
      toast({
        title: `Créées : ${ok}/${drafts.length}`,
        description: `${failedLines.length} échec${failedLines.length > 1 ? "s" : ""} conservé${failedLines.length > 1 ? "s" : ""} dans le texte — corrige et relance la création.`,
        variant: "destructive",
      });
    } else {
      toast({
        title: "Aucune carte créée",
        description: lastError instanceof Error ? lastError.message : String(lastError),
        variant: "destructive",
      });
    }
  }, [deckId, drafts, createNote, toast]);

  const deckList = decks.data ?? [];

  return (
    <div className="space-y-6">
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
                    <ScanText className="h-4 w-4" />
                    Extraire le texte (OCR)
                  </>
                )}
              </Button>
              <Select
                value={ocrLang}
                onValueChange={(v) => setOcrLang(v as OcrLang)}
                disabled={busy}
              >
                <SelectTrigger className="w-[160px]" aria-label="Langue de reconnaissance">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OCR_LANGUAGES.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
              <div
                className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-label="Progression de la reconnaissance OCR"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(progress * 100)}
                aria-live="polite"
              >
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
