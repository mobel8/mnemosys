/**
 * AI flashcard generator — full editor flow.
 *
 * Pipeline:
 *   1. User picks a deck + source (raw text or PDF path) + a few knobs
 *      (max cards, language).
 *   2. We call `useGenerateCardsFromText` or `useGenerateCardsFromPdf` to
 *      get a `GeneratedCard[]` from Claude.
 *   3. Cards land in local `drafts` state, each with a stable client-side
 *      id so the user can rearrange / edit / drop them without losing
 *      React keys.
 *   4. "Valider et créer N cartes" walks `drafts` **sequentially** through
 *      `useCreateNote.mutateAsync` — parallel calls would spam the DB and
 *      lose deterministic ordering, which matters for downstream review
 *      sessions.
 *
 * Resilience policy:
 *   - 0 cartes générées → inline message, no toast spam.
 *   - Anthropic API key missing → caught from the error message, with a
 *     CTA toward `/settings`.
 *   - PDF tab without picked file → button disabled; we never call the
 *     backend with an empty path.
 *
 * The shadcn `Select` component isn't part of this project's UI kit, so
 * the deck + language pickers fall back to native `<select>` elements
 * styled to match the `Input` component.
 */

import { Link } from "@tanstack/react-router";
import { open } from "@tauri-apps/plugin-dialog";
import { FileText, Loader2, Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";
import {
  useCreateNote,
  useDecks,
  useGenerateCardsFromPdf,
  useGenerateCardsFromText,
} from "@/lib/queries";
import type { AICardTemplate, GeneratedCard, NoteTemplate } from "@/lib/tauri";
import { cn } from "@/lib/utils";

/** Max chars accepted in the text-area before we refuse to submit. */
const MAX_TEXT_CHARS = 50_000;
const DEFAULT_MAX_CARDS = 10;
const MAX_CARDS_HARD_CAP = 50;

/** Language picker options. Value is the locale hint sent to the backend. */
const LANGUAGES = [
  { value: "fr", label: "Français" },
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
] as const;

type LanguageValue = (typeof LANGUAGES)[number]["value"];
type SourceTab = "text" | "pdf";

/**
 * Local working copy of a `GeneratedCard`. We carry an `id` so React keys
 * stay stable through edits / removals (the backend returns no id of its
 * own — generation is stateless).
 */
interface CardDraft {
  id: string;
  template: AICardTemplate;
  front: string;
  back: string;
  text: string;
  tags: string[];
}

function draftFromGenerated(card: GeneratedCard, index: number): CardDraft {
  const fields = card.fields;
  const front = typeof fields.front === "string" ? fields.front : "";
  const back = typeof fields.back === "string" ? fields.back : "";
  const text = typeof fields.text === "string" ? fields.text : "";
  return {
    // `index` keeps ids ordered when multiple drafts are minted in the same tick.
    id: `${Date.now().toString(36)}-${index}-${Math.random().toString(36).slice(2, 8)}`,
    template: card.template,
    front,
    back,
    text,
    tags: Array.isArray(card.tags) ? card.tags : [],
  };
}

/**
 * Map an `AICardTemplate` to the `NoteTemplate` accepted by `create_note`.
 * The backend currently supports a direct 1:1 mapping for both shapes.
 */
function toNoteTemplate(template: AICardTemplate): NoteTemplate {
  return template === "cloze" ? "cloze" : "basic";
}

function isApiKeyError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /api[_ ]?key|anthropic|unauthor/i.test(msg);
}

export function AiGenerator() {
  const decksQuery = useDecks();
  const decks = useMemo(() => decksQuery.data ?? [], [decksQuery.data]);

  // Form state ------------------------------------------------------------
  const [deckId, setDeckId] = useState<number | null>(null);
  const [sourceTab, setSourceTab] = useState<SourceTab>("text");
  const [text, setText] = useState("");
  const [pdfPath, setPdfPath] = useState<string | null>(null);
  const [maxCards, setMaxCards] = useState<number>(DEFAULT_MAX_CARDS);
  const [language, setLanguage] = useState<LanguageValue>("fr");

  // Drafts (the validation queue) ----------------------------------------
  const [drafts, setDrafts] = useState<CardDraft[]>([]);
  const [isCreatingAll, setIsCreatingAll] = useState(false);

  // Initialise deckId once decks load. We pick the first deck so the form
  // is immediately usable; the user can still pick another one. Using an
  // effect (rather than a setState during render) avoids React's
  // "Cannot update a component while rendering" warning.
  useEffect(() => {
    if (deckId !== null) return;
    const first = decks[0];
    if (first) setDeckId(first.id);
  }, [deckId, decks]);

  // Mutations -------------------------------------------------------------
  const genText = useGenerateCardsFromText();
  const genPdf = useGenerateCardsFromPdf();
  const createNote = useCreateNote();

  const isGenerating = genText.isPending || genPdf.isPending;

  // Stable ids for accessible label/control wiring.
  const deckSelectId = useId();
  const textInputId = useId();
  const maxCardsId = useId();
  const langSelectId = useId();

  // ----- Handlers --------------------------------------------------------

  async function handlePickPdf() {
    try {
      const picked = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (!picked) return; // user cancelled
      const path = typeof picked === "string" ? picked : picked[0];
      if (path) setPdfPath(path);
    } catch (err) {
      toast({
        title: "Sélection impossible",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  }

  function handleGenerationError(err: unknown) {
    if (isApiKeyError(err)) {
      toast({
        title: "Clé API Anthropic manquante",
        description: "Configure ta clé dans les paramètres avant de générer des cartes.",
        variant: "destructive",
      });
      return;
    }
    toast({
      title: "Génération impossible",
      description: err instanceof Error ? err.message : String(err),
      variant: "destructive",
    });
  }

  async function handleGenerate() {
    const safeMaxCards = clampMaxCards(maxCards);
    try {
      const cards =
        sourceTab === "text"
          ? await genText.mutateAsync({
              text: text.trim(),
              maxCards: safeMaxCards,
              language,
            })
          : await genPdf.mutateAsync({
              // Cast guarded by `canGenerate` — button is disabled when null.
              pdfPath: pdfPath ?? "",
              maxCards: safeMaxCards,
              language,
            });
      const nextDrafts = cards.map((c, i) => draftFromGenerated(c, i));
      setDrafts(nextDrafts);
      if (nextDrafts.length === 0) {
        toast({
          title: "Aucune carte générée",
          description:
            "Claude n'a rien renvoyé pour cette source. Essaie un texte plus long ou un autre extrait.",
        });
      } else {
        toast({
          title: "Cartes générées",
          description: `${nextDrafts.length} carte${nextDrafts.length > 1 ? "s" : ""} prête${nextDrafts.length > 1 ? "s" : ""} à être validée${nextDrafts.length > 1 ? "s" : ""}.`,
        });
      }
    } catch (err) {
      handleGenerationError(err);
    }
  }

  function updateDraft(id: string, patch: Partial<CardDraft>) {
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }

  function removeDraft(id: string) {
    setDrafts((prev) => prev.filter((d) => d.id !== id));
  }

  function resetAll() {
    setDrafts([]);
    setText("");
    setPdfPath(null);
  }

  async function handleCreateAll() {
    if (deckId === null || drafts.length === 0) return;
    setIsCreatingAll(true);
    let created = 0;
    const failures: string[] = [];
    try {
      // Sequential — see file header for the rationale.
      for (const draft of drafts) {
        const fields: Record<string, unknown> =
          draft.template === "cloze"
            ? { text: draft.text.trim() }
            : { front: draft.front.trim(), back: draft.back.trim() };
        try {
          await createNote.mutateAsync({
            deckId,
            template: toNoteTemplate(draft.template),
            fields,
            tags: draft.tags,
          });
          created += 1;
        } catch (err) {
          failures.push(err instanceof Error ? err.message : String(err));
        }
      }
    } finally {
      setIsCreatingAll(false);
    }
    if (created > 0) {
      toast({
        title: `${created} carte${created > 1 ? "s" : ""} créée${created > 1 ? "s" : ""}`,
        description:
          failures.length === 0
            ? "Toutes les cartes ont été ajoutées au deck."
            : `${failures.length} échec${failures.length > 1 ? "s" : ""} (voir console).`,
      });
      // Clear out the queue so the user doesn't double-submit.
      setDrafts([]);
    }
    if (failures.length > 0 && created === 0) {
      toast({
        title: "Aucune carte créée",
        description: failures[0] ?? "Échec inconnu.",
        variant: "destructive",
      });
    }
  }

  // ----- Derived flags ---------------------------------------------------

  const trimmedTextLen = text.trim().length;
  const textTooLong = text.length > MAX_TEXT_CHARS;

  const canGenerate = (() => {
    if (deckId === null) return false;
    if (isGenerating) return false;
    if (sourceTab === "text") return trimmedTextLen > 0 && !textTooLong;
    return pdfPath !== null;
  })();

  return (
    <div className="space-y-6">
      {/* ---------- Config Card ---------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Sparkles className="h-5 w-5 text-primary" />
            Source &amp; paramètres
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Deck picker */}
          <div className="space-y-2">
            <Label htmlFor={deckSelectId}>Deck cible</Label>
            {decksQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Chargement des decks…</p>
            ) : decks.length === 0 ? (
              <div className="rounded-md border border-dashed bg-muted/30 p-3 text-sm text-muted-foreground">
                Aucun deck disponible.{" "}
                <Link
                  to="/"
                  className="font-medium text-primary underline-offset-2 hover:underline"
                >
                  Crée d'abord un deck
                </Link>{" "}
                pour pouvoir générer des cartes.
              </div>
            ) : (
              <select
                id={deckSelectId}
                value={deckId ?? ""}
                onChange={(e) => setDeckId(Number(e.target.value))}
                className={cn(
                  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                )}
              >
                {decks.map((deck) => (
                  <option key={deck.id} value={deck.id}>
                    {deck.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Source tabs */}
          <Tabs value={sourceTab} onValueChange={(next) => setSourceTab(next as SourceTab)}>
            <TabsList>
              <TabsTrigger value="text">Texte</TabsTrigger>
              <TabsTrigger value="pdf">PDF</TabsTrigger>
            </TabsList>

            <TabsContent value="text" className="space-y-2">
              <Label htmlFor={textInputId}>Texte source</Label>
              <Textarea
                id={textInputId}
                rows={8}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Colle ici un cours, un article…"
                className={cn(
                  "min-h-[180px] font-mono text-sm",
                  textTooLong && "border-destructive",
                )}
              />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {text.length.toLocaleString("fr-FR")} / {MAX_TEXT_CHARS.toLocaleString("fr-FR")}{" "}
                  caractères
                </span>
                {textTooLong && (
                  <span className="text-destructive">Texte trop long, réduis-le.</span>
                )}
              </div>
            </TabsContent>

            <TabsContent value="pdf" className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" onClick={handlePickPdf}>
                  <FileText className="h-4 w-4" />
                  Choisir un PDF
                </Button>
                {pdfPath && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setPdfPath(null)}
                    aria-label="Effacer le PDF sélectionné"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
              {pdfPath ? (
                <p className="break-all rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                  {pdfPath}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Aucun fichier sélectionné. Choisis un PDF lisible (pas une image scannée).
                </p>
              )}
            </TabsContent>
          </Tabs>

          {/* Knobs row */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={maxCardsId}>Nombre de cartes max</Label>
              <Input
                id={maxCardsId}
                type="number"
                min={1}
                max={MAX_CARDS_HARD_CAP}
                value={maxCards}
                onChange={(e) => setMaxCards(parseIntSafe(e.target.value, DEFAULT_MAX_CARDS))}
              />
              <p className="text-xs text-muted-foreground">Entre 1 et {MAX_CARDS_HARD_CAP}.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor={langSelectId}>Langue</Label>
              <select
                id={langSelectId}
                value={language}
                onChange={(e) => setLanguage(e.target.value as LanguageValue)}
                className={cn(
                  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                )}
              >
                {LANGUAGES.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button type="button" onClick={handleGenerate} disabled={!canGenerate}>
              {isGenerating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Génération…
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Générer
                </>
              )}
            </Button>
            {drafts.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                onClick={resetAll}
                disabled={isCreatingAll || isGenerating}
              >
                Réinitialiser
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ---------- Drafts list ---------- */}
      {drafts.length > 0 && (
        <section aria-labelledby="ai-drafts-heading" className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 id="ai-drafts-heading" className="text-lg font-semibold tracking-tight">
              Cartes proposées ({drafts.length})
            </h2>
            <p className="text-xs text-muted-foreground">
              Édite ou retire les cartes avant validation.
            </p>
          </div>

          <ol className="space-y-3">
            {drafts.map((draft, index) => (
              <li key={draft.id}>
                <DraftCard
                  draft={draft}
                  index={index}
                  disabled={isCreatingAll}
                  onChange={(patch) => updateDraft(draft.id, patch)}
                  onRemove={() => removeDraft(draft.id)}
                />
              </li>
            ))}
          </ol>

          <div className="sticky bottom-4 flex flex-wrap items-center justify-end gap-2 rounded-lg border bg-background/95 p-3 shadow-md backdrop-blur supports-[backdrop-filter]:bg-background/80">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setDrafts([])}
              disabled={isCreatingAll}
            >
              <Trash2 className="h-4 w-4" />
              Tout rejeter
            </Button>
            <Button
              type="button"
              onClick={handleCreateAll}
              disabled={isCreatingAll || deckId === null}
            >
              {isCreatingAll ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Création…
                </>
              ) : (
                <>
                  Valider et créer {drafts.length} carte{drafts.length > 1 ? "s" : ""}
                </>
              )}
            </Button>
          </div>
        </section>
      )}

      {/* ---------- Empty state hint ---------- */}
      {drafts.length === 0 && !isGenerating && (
        <Card className="border-dashed">
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            <p>
              Les cartes générées apparaîtront ici. Si la clé API Anthropic n'est pas configurée,
              ajoute-la dans{" "}
              <Link
                to="/settings"
                className="font-medium text-primary underline-offset-2 hover:underline"
              >
                les paramètres
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Internal: <DraftCard /> — one editable line in the validation queue.
// ---------------------------------------------------------------------------

interface DraftCardProps {
  draft: CardDraft;
  index: number;
  disabled: boolean;
  onChange: (patch: Partial<CardDraft>) => void;
  onRemove: () => void;
}

function DraftCard({ draft, index, disabled, onChange, onRemove }: DraftCardProps) {
  const frontId = useId();
  const backId = useId();
  const textId = useId();

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="font-mono">
              #{index + 1}
            </Badge>
            <Badge variant={draft.template === "cloze" ? "default" : "outline"}>
              {draft.template === "cloze" ? "Cloze" : "Basic"}
            </Badge>
            {draft.tags.map((tag) => (
              <Badge key={tag} variant="outline" className="font-normal">
                {tag}
              </Badge>
            ))}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onRemove}
            disabled={disabled}
            aria-label={`Rejeter la carte ${index + 1}`}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {draft.template === "basic" ? (
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={frontId} className="text-xs uppercase tracking-wide">
                Front
              </Label>
              <Textarea
                id={frontId}
                rows={3}
                value={draft.front}
                onChange={(e) => onChange({ front: e.target.value })}
                disabled={disabled}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={backId} className="text-xs uppercase tracking-wide">
                Back
              </Label>
              <Textarea
                id={backId}
                rows={3}
                value={draft.back}
                onChange={(e) => onChange({ back: e.target.value })}
                disabled={disabled}
              />
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor={textId} className="text-xs uppercase tracking-wide">
              Texte cloze
            </Label>
            <Textarea
              id={textId}
              rows={4}
              value={draft.text}
              onChange={(e) => onChange({ text: e.target.value })}
              disabled={disabled}
              className="font-mono text-sm"
            />
            <p className="text-[11px] text-muted-foreground">
              Syntaxe : <code>{`{{c1::mot caché}}`}</code> — utilise <code>c2</code>,{" "}
              <code>c3</code> pour plusieurs cartes à partir du même texte.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Parse an integer from a text-input value, falling back to `fallback`. */
function parseIntSafe(raw: string, fallback: number): number {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return fallback;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Clamp to [1, MAX_CARDS_HARD_CAP]; fall back to the default on garbage input. */
function clampMaxCards(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_MAX_CARDS;
  if (value < 1) return 1;
  if (value > MAX_CARDS_HARD_CAP) return MAX_CARDS_HARD_CAP;
  return Math.floor(value);
}
