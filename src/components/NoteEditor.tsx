/**
 * Multi-template note editor used by the "Add card" page.
 *
 * Four tabs map to the four note templates supported by the Rust backend:
 *   - `basic`: front + back
 *   - `basic_reverse`: front + back, generates two cards
 *   - `cloze`: single text field with `{{c1::...}}` syntax + live preview
 *   - `occlusion`: image + N rectangular masks, generates one card per mask
 *
 * Tags are entered as chips (Enter or comma to commit, backspace on empty
 * input removes the last). Keyboard shortcuts:
 *   - Ctrl/Cmd + Enter → submit (text templates only — the occlusion editor
 *     owns its own submit button because its inputs aren't textareas).
 *
 * On a successful submit we toast and reset; "Save and continue" reuses the
 * tag list but clears the fields and refocuses the first input.
 */

import { useRef, useState } from "react";
import { ClozePreview, uniqueClozeNumbers } from "@/components/ClozePreview";
import { OcclusionEditor } from "@/components/OcclusionEditor";
import { TtsButton } from "@/components/TtsButton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";
import { useCreateNote } from "@/lib/queries";
import type { NoteTemplate } from "@/lib/tauri";
import { cn } from "@/lib/utils";

const MAX_TAGS = 10;
const TAG_SEPARATORS = [",", "Enter"];

type TemplateTab = NoteTemplate;

interface NoteEditorProps {
  deckId: number;
  onAdded?: () => void;
}

export function NoteEditor({ deckId, onAdded }: NoteEditorProps) {
  const [template, setTemplate] = useState<TemplateTab>("basic");
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [clozeText, setClozeText] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");

  const frontRef = useRef<HTMLTextAreaElement | null>(null);
  const clozeRef = useRef<HTMLTextAreaElement | null>(null);

  const createNote = useCreateNote();

  function resetFields(keepTags = false) {
    setFront("");
    setBack("");
    setClozeText("");
    if (!keepTags) setTags([]);
    setTagInput("");
  }

  function handleTemplateChange(next: string) {
    const value = next as TemplateTab;
    setTemplate(value);
    resetFields(true);
  }

  function commitTagInput() {
    const cleaned = tagInput
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    if (cleaned.length === 0) {
      setTagInput("");
      return;
    }
    setTags((prev) => {
      const merged = [...prev];
      for (const tag of cleaned) {
        if (!merged.includes(tag) && merged.length < MAX_TAGS) {
          merged.push(tag);
        }
      }
      return merged;
    });
    setTagInput("");
  }

  function handleTagKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (TAG_SEPARATORS.includes(e.key)) {
      e.preventDefault();
      commitTagInput();
    } else if (e.key === "Backspace" && tagInput.length === 0 && tags.length > 0) {
      setTags((prev) => prev.slice(0, -1));
    }
  }

  function removeTag(tag: string) {
    setTags((prev) => prev.filter((t) => t !== tag));
  }

  function validate(): { ok: true; fields: Record<string, unknown> } | { ok: false } {
    if (template === "basic" || template === "basic_reverse") {
      const f = front.trim();
      const b = back.trim();
      if (f.length === 0 || b.length === 0) {
        toast({
          title: "Champs incomplets",
          description: "Front et Back sont obligatoires.",
          variant: "destructive",
        });
        return { ok: false };
      }
      return { ok: true, fields: { front: f, back: b } };
    }
    if (template === "cloze") {
      const text = clozeText.trim();
      const numbers = uniqueClozeNumbers(text);
      if (text.length === 0 || numbers.length === 0) {
        toast({
          title: "Cloze invalide",
          description: "Ajoute au moins un {{c1::texte}} pour créer une carte.",
          variant: "destructive",
        });
        return { ok: false };
      }
      return { ok: true, fields: { text } };
    }
    // "occlusion" is handled by the dedicated editor (early return above),
    // so this branch should be unreachable.
    return { ok: false };
  }

  function submit(continueAfter: boolean) {
    const validation = validate();
    if (!validation.ok) return;
    // If the user typed a tag but didn't press Enter, capture it on submit.
    if (tagInput.trim().length > 0) commitTagInput();
    createNote.mutate(
      {
        deckId,
        template,
        fields: validation.fields,
        tags,
      },
      {
        onSuccess: () => {
          toast({
            title: "Carte ajoutée",
            description:
              template === "basic_reverse"
                ? "2 cartes ont été créées."
                : template === "cloze"
                  ? `${uniqueClozeNumbers(clozeText).length} carte(s) cloze créée(s).`
                  : "1 carte créée.",
          });
          if (continueAfter) {
            resetFields(true);
            requestAnimationFrame(() => {
              if (template === "cloze") clozeRef.current?.focus();
              else frontRef.current?.focus();
            });
          } else {
            onAdded?.();
          }
        },
        onError: (err) => {
          toast({
            title: "Création impossible",
            description: err.message,
            variant: "destructive",
          });
        },
      },
    );
  }

  function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    submit(false);
  }

  function handleEditorKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      submit(false);
    }
  }

  const isCloze = template === "cloze";
  const isOcclusion = template === "occlusion";

  // The occlusion editor owns its own image picker + masks UI + submit
  // button, so we render it standalone (no <form>, no submit/tag rows below).
  if (isOcclusion) {
    return (
      <div className="space-y-6">
        <Tabs value={template} onValueChange={handleTemplateChange}>
          <TabsList>
            <TabsTrigger value="basic">Basic</TabsTrigger>
            <TabsTrigger value="basic_reverse">Basic + Reverse</TabsTrigger>
            <TabsTrigger value="cloze">Cloze</TabsTrigger>
            <TabsTrigger value="occlusion">Image-occlusion</TabsTrigger>
          </TabsList>
          <TabsContent value="occlusion" className="space-y-4">
            <OcclusionEditor deckId={deckId} onSaved={() => onAdded?.()} />
          </TabsContent>
        </Tabs>
      </div>
    );
  }

  return (
    <form onSubmit={handleFormSubmit} className="space-y-6">
      <Tabs value={template} onValueChange={handleTemplateChange}>
        <TabsList>
          <TabsTrigger value="basic">Basic</TabsTrigger>
          <TabsTrigger value="basic_reverse">Basic + Reverse</TabsTrigger>
          <TabsTrigger value="cloze">Cloze</TabsTrigger>
          <TabsTrigger value="occlusion">Image-occlusion</TabsTrigger>
        </TabsList>

        <TabsContent value="basic" className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="front">Front</Label>
              <TtsButton text={front} />
            </div>
            <Textarea
              id="front"
              ref={frontRef}
              value={front}
              onChange={(e) => setFront(e.target.value)}
              onKeyDown={handleEditorKeyDown}
              rows={4}
              placeholder="Quelle est la capitale du Japon ?"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="back">Back</Label>
              <TtsButton text={back} />
            </div>
            <Textarea
              id="back"
              value={back}
              onChange={(e) => setBack(e.target.value)}
              onKeyDown={handleEditorKeyDown}
              rows={4}
              placeholder="Tokyo"
            />
          </div>
        </TabsContent>

        <TabsContent value="basic_reverse" className="space-y-4">
          <p className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
            Génère <strong>deux cartes</strong> : Front → Back <em>et</em> Back → Front.
          </p>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="front-rev">Front</Label>
              <TtsButton text={front} />
            </div>
            <Textarea
              id="front-rev"
              ref={frontRef}
              value={front}
              onChange={(e) => setFront(e.target.value)}
              onKeyDown={handleEditorKeyDown}
              rows={4}
              placeholder="vergissmeinnicht"
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="back-rev">Back</Label>
              <TtsButton text={back} />
            </div>
            <Textarea
              id="back-rev"
              value={back}
              onChange={(e) => setBack(e.target.value)}
              onKeyDown={handleEditorKeyDown}
              rows={4}
              placeholder="myosotis (forget-me-not)"
            />
          </div>
        </TabsContent>

        <TabsContent value="cloze" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="cloze-text">Texte</Label>
                <TtsButton text={clozeText.replace(/\{\{c\d+::([^}]+?)(?:::[^}]+?)?\}\}/g, "$1")} />
              </div>
              <Textarea
                id="cloze-text"
                ref={clozeRef}
                value={clozeText}
                onChange={(e) => setClozeText(e.target.value)}
                onKeyDown={handleEditorKeyDown}
                rows={10}
                placeholder="La capitale de la {{c1::France}} est {{c2::Paris}}."
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Utilise <code>{`{{c1::caché}}`}</code> pour cacher un mot. Tu peux faire{" "}
                <code>{`{{c1::X}}`}</code> <code>{`{{c2::Y}}`}</code> pour générer plusieurs cartes
                à partir du même texte.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Aperçu</Label>
              <ClozePreview text={clozeText} />
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <div className="space-y-2">
        <Label htmlFor="tags">Tags</Label>
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-input bg-transparent px-3 py-2 shadow-sm focus-within:ring-1 focus-within:ring-ring">
          {tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="gap-1 font-normal">
              {tag}
              <button
                type="button"
                aria-label={`Retirer ${tag}`}
                onClick={() => removeTag(tag)}
                className="ml-0.5 rounded-full text-muted-foreground hover:text-foreground"
              >
                ×
              </button>
            </Badge>
          ))}
          <input
            id="tags"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={handleTagKeyDown}
            onBlur={() => commitTagInput()}
            placeholder={tags.length === 0 ? "Ajoute des tags (Entrée ou virgule)" : ""}
            className={cn(
              "flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground",
              "min-w-[120px]",
            )}
            disabled={tags.length >= MAX_TAGS}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {tags.length}/{MAX_TAGS} tags. Entrée ou virgule pour valider.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={createNote.isPending}>
          {createNote.isPending ? "Ajout…" : "Ajouter"}
          <kbd className="ml-2 hidden rounded bg-primary-foreground/10 px-1.5 py-0.5 text-[10px] sm:inline-block">
            Ctrl+Enter
          </kbd>
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={createNote.isPending}
          onClick={() => submit(true)}
        >
          Ajouter et continuer
        </Button>
        {isCloze && uniqueClozeNumbers(clozeText).length > 0 && (
          <span className="text-xs text-muted-foreground">
            {uniqueClozeNumbers(clozeText).length} cloze(s) détecté(s)
          </span>
        )}
      </div>
    </form>
  );
}
