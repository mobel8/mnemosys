/**
 * Multi-template note editor used by the "Add card" page.
 *
 * Five tabs map to note templates supported by the Rust backend:
 *   - `basic`: front + back
 *   - `basic_reverse`: front + back, generates two cards
 *   - `cloze`: single text field with `{{c1::...}}` syntax + live preview
 *   - `occlusion`: image + N rectangular masks, generates one card per mask
 *   - `bidirectional` ("Phrase", Vague 10): source + target (+ optional hint
 *     and frequency band), generates two language-learning cards (L2↔L1)
 *   - `illness_script` ("Médecine", Vague 14): condition + four clinical
 *     sections, generates one structured clinical card (Charlin 2007)
 *   - `refutation` ("Sciences", Vague 14): misconception + correction (+
 *     optional explanation), generates one card confronting a false belief
 *     (Tippett 2010 meta)
 *   - `worked_example` ("Maths", Vague 15): problem + ordered solution steps +
 *     final answer, generates one card whose steps fade in progressively on
 *     the verso (Sweller/Renkl/Atkinson 2003)
 *
 * Tags are entered as chips (Enter or comma to commit, backspace on empty
 * input removes the last). Keyboard shortcuts:
 *   - Ctrl/Cmd + Enter → submit (text templates only — the occlusion editor
 *     owns its own submit button because its inputs aren't textareas).
 *
 * On a successful submit we toast and reset; "Save and continue" reuses the
 * tag list but clears the fields and refocuses the first input.
 */

import { FlaskConical, Languages, Plus, Sigma, Stethoscope, X } from "lucide-react";
import { useRef, useState } from "react";
import { ClozePreview, uniqueClozeNumbers } from "@/components/ClozePreview";
import { OcclusionEditor } from "@/components/OcclusionEditor";
import { TtsButton } from "@/components/TtsButton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";
import { FREQUENCY_BAND_OPTIONS } from "@/lib/languages";
import { useCreateNote } from "@/lib/queries";
import type { FrequencyBand, NoteTemplate } from "@/lib/tauri";
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
  // Vague 10 — sentence ("Phrase") template state.
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const [hint, setHint] = useState("");
  const [frequencyBand, setFrequencyBand] = useState<FrequencyBand | null>(null);
  // Vague 14 — Médecine ("illness_script") template state.
  const [condition, setCondition] = useState("");
  const [epidemiology, setEpidemiology] = useState("");
  const [pathophysiology, setPathophysiology] = useState("");
  const [clinical, setClinical] = useState("");
  const [management, setManagement] = useState("");
  // Vague 14 — Sciences ("refutation") template state.
  const [misconception, setMisconception] = useState("");
  const [correct, setCorrect] = useState("");
  const [explanation, setExplanation] = useState("");
  // Vague 15 — Maths ("worked_example") template state. `steps` always holds
  // at least one (possibly empty) row so the dynamic list renders one input.
  const [problem, setProblem] = useState("");
  const [steps, setSteps] = useState<string[]>([""]);
  const [answer, setAnswer] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");

  const frontRef = useRef<HTMLTextAreaElement | null>(null);
  const clozeRef = useRef<HTMLTextAreaElement | null>(null);
  const sourceRef = useRef<HTMLInputElement | null>(null);
  const conditionRef = useRef<HTMLInputElement | null>(null);
  const misconceptionRef = useRef<HTMLTextAreaElement | null>(null);
  const problemRef = useRef<HTMLTextAreaElement | null>(null);

  const createNote = useCreateNote();

  function resetFields(keepTags = false) {
    setFront("");
    setBack("");
    setClozeText("");
    setSource("");
    setTarget("");
    setHint("");
    setFrequencyBand(null);
    setCondition("");
    setEpidemiology("");
    setPathophysiology("");
    setClinical("");
    setManagement("");
    setMisconception("");
    setCorrect("");
    setExplanation("");
    setProblem("");
    setSteps([""]);
    setAnswer("");
    if (!keepTags) setTags([]);
    setTagInput("");
  }

  // --- Vague 15 — worked-example dynamic step list helpers ----------------
  function updateStep(index: number, value: string) {
    setSteps((prev) => prev.map((s, i) => (i === index ? value : s)));
  }
  function addStep() {
    setSteps((prev) => [...prev, ""]);
  }
  function removeStep(index: number) {
    // Keep at least one row so the list never collapses to nothing.
    setSteps((prev) => (prev.length <= 1 ? [""] : prev.filter((_s, i) => i !== index)));
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
    if (template === "bidirectional") {
      const s = source.trim();
      const t = target.trim();
      if (s.length === 0 || t.length === 0) {
        toast({
          title: "Champs incomplets",
          description: "La phrase et sa traduction sont obligatoires.",
          variant: "destructive",
        });
        return { ok: false };
      }
      const h = hint.trim();
      return { ok: true, fields: h ? { source: s, target: t, hint: h } : { source: s, target: t } };
    }
    if (template === "illness_script") {
      const c = condition.trim();
      if (c.length === 0) {
        toast({
          title: "Champs incomplets",
          description: "La condition (le diagnostic) est obligatoire.",
          variant: "destructive",
        });
        return { ok: false };
      }
      const epi = epidemiology.trim();
      const patho = pathophysiology.trim();
      const clin = clinical.trim();
      const mgmt = management.trim();
      if (epi.length === 0 && patho.length === 0 && clin.length === 0 && mgmt.length === 0) {
        toast({
          title: "Fiche incomplète",
          description:
            "Remplis au moins une section (épidémiologie, physiopathologie, clinique ou prise en charge).",
          variant: "destructive",
        });
        return { ok: false };
      }
      // Only persist the non-empty sections; `condition` is always present.
      const fields: Record<string, unknown> = { condition: c };
      if (epi.length > 0) fields.epidemiology = epi;
      if (patho.length > 0) fields.pathophysiology = patho;
      if (clin.length > 0) fields.clinical = clin;
      if (mgmt.length > 0) fields.management = mgmt;
      return { ok: true, fields };
    }
    if (template === "refutation") {
      const m = misconception.trim();
      const c = correct.trim();
      if (m.length === 0 || c.length === 0) {
        toast({
          title: "Champs incomplets",
          description: "L'idée fausse et sa correction sont obligatoires.",
          variant: "destructive",
        });
        return { ok: false };
      }
      const expl = explanation.trim();
      return {
        ok: true,
        fields: expl
          ? { misconception: m, correct: c, explanation: expl }
          : { misconception: m, correct: c },
      };
    }
    if (template === "worked_example") {
      const p = problem.trim();
      const a = answer.trim();
      const cleanedSteps = steps.map((s) => s.trim()).filter((s) => s.length > 0);
      if (p.length === 0 || a.length === 0) {
        toast({
          title: "Champs incomplets",
          description: "L'énoncé du problème et la réponse finale sont obligatoires.",
          variant: "destructive",
        });
        return { ok: false };
      }
      if (cleanedSteps.length === 0) {
        toast({
          title: "Étapes manquantes",
          description: "Ajoute au moins une étape de résolution.",
          variant: "destructive",
        });
        return { ok: false };
      }
      return { ok: true, fields: { problem: p, steps: cleanedSteps, answer: a } };
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
        frequencyBand: template === "bidirectional" ? frequencyBand : null,
      },
      {
        onSuccess: () => {
          toast({
            title: "Carte ajoutée",
            description:
              template === "basic_reverse" || template === "bidirectional"
                ? "2 cartes ont été créées."
                : template === "cloze"
                  ? `${uniqueClozeNumbers(clozeText).length} carte(s) cloze créée(s).`
                  : "1 carte créée.",
          });
          if (continueAfter) {
            resetFields(true);
            requestAnimationFrame(() => {
              if (template === "cloze") clozeRef.current?.focus();
              else if (template === "bidirectional") sourceRef.current?.focus();
              else if (template === "illness_script") conditionRef.current?.focus();
              else if (template === "refutation") misconceptionRef.current?.focus();
              else if (template === "worked_example") problemRef.current?.focus();
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
          <TabsTrigger value="bidirectional" className="gap-1.5">
            <Languages className="h-3.5 w-3.5" />
            Phrase
          </TabsTrigger>
          <TabsTrigger value="illness_script" className="gap-1.5">
            <Stethoscope className="h-3.5 w-3.5" />
            Médecine
          </TabsTrigger>
          <TabsTrigger value="refutation" className="gap-1.5">
            <FlaskConical className="h-3.5 w-3.5" />
            Sciences
          </TabsTrigger>
          <TabsTrigger value="worked_example" className="gap-1.5">
            <Sigma className="h-3.5 w-3.5" />
            Maths
          </TabsTrigger>
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

        <TabsContent value="bidirectional" className="space-y-4">
          <p className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
            Génère <strong>deux cartes</strong> : langue cible → traduction <em>et</em> traduction →
            langue cible (méthode Lampariello).
          </p>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="sentence-source">Phrase (langue cible)</Label>
              <TtsButton text={source} />
            </div>
            <Input
              id="sentence-source"
              ref={sourceRef}
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="Ich lerne jeden Tag Deutsch."
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sentence-target">Traduction</Label>
            <Input
              id="sentence-target"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="J'apprends l'allemand tous les jours."
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sentence-hint">Indice / note (optionnel)</Label>
            <Input
              id="sentence-hint"
              value={hint}
              onChange={(e) => setHint(e.target.value)}
              placeholder="jeden Tag = tous les jours"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sentence-freq">Bande de fréquence</Label>
            <select
              id="sentence-freq"
              value={frequencyBand ?? ""}
              onChange={(e) => setFrequencyBand((e.target.value || null) as FrequencyBand | null)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {FREQUENCY_BAND_OPTIONS.map((opt) => (
                <option key={opt.value ?? "none"} value={opt.value ?? ""}>
                  {opt.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              Classe le vocabulaire par fréquence pour suivre ta couverture lexicale (Pareto 80/20).
            </p>
          </div>
          {(source.trim() || target.trim()) && (
            <div className="space-y-2">
              <Label>Aperçu des 2 cartes</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-md border p-3 text-sm">
                  <div className="text-xs font-medium text-muted-foreground">Carte 1 (recto)</div>
                  <div className="mt-1">{source.trim() || "…"}</div>
                  <div className="mt-2 text-xs font-medium text-muted-foreground">verso</div>
                  <div className="mt-1 text-muted-foreground">{target.trim() || "…"}</div>
                </div>
                <div className="rounded-md border p-3 text-sm">
                  <div className="text-xs font-medium text-muted-foreground">Carte 2 (recto)</div>
                  <div className="mt-1">{target.trim() || "…"}</div>
                  <div className="mt-2 text-xs font-medium text-muted-foreground">verso</div>
                  <div className="mt-1 text-muted-foreground">{source.trim() || "…"}</div>
                </div>
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="illness_script" className="space-y-4">
          <p className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
            Fiche clinique structurée (<em>illness script</em>, Charlin 2007) : une carte qui
            demande le tableau d'une pathologie à partir de son nom.
          </p>
          <div className="space-y-2">
            <Label htmlFor="illness-condition">Condition / diagnostic</Label>
            <Input
              id="illness-condition"
              ref={conditionRef}
              value={condition}
              onChange={(e) => setCondition(e.target.value)}
              placeholder="Infarctus du myocarde"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="illness-epidemiology">Épidémiologie</Label>
              <Textarea
                id="illness-epidemiology"
                value={epidemiology}
                onChange={(e) => setEpidemiology(e.target.value)}
                onKeyDown={handleEditorKeyDown}
                rows={3}
                placeholder="Terrain, facteurs de risque, prévalence…"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="illness-pathophysiology">Physiopathologie</Label>
              <Textarea
                id="illness-pathophysiology"
                value={pathophysiology}
                onChange={(e) => setPathophysiology(e.target.value)}
                onKeyDown={handleEditorKeyDown}
                rows={3}
                placeholder="Mécanisme sous-jacent…"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="illness-clinical">Clinique</Label>
              <Textarea
                id="illness-clinical"
                value={clinical}
                onChange={(e) => setClinical(e.target.value)}
                onKeyDown={handleEditorKeyDown}
                rows={3}
                placeholder="Signes, symptômes, présentation typique…"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="illness-management">Prise en charge</Label>
              <Textarea
                id="illness-management"
                value={management}
                onChange={(e) => setManagement(e.target.value)}
                onKeyDown={handleEditorKeyDown}
                rows={3}
                placeholder="Examens, traitement, suivi…"
              />
            </div>
          </div>
          {condition.trim() && (
            <div className="space-y-2">
              <Label>Aperçu de la carte</Label>
              <div className="rounded-md border p-3 text-sm">
                <div className="text-xs font-medium text-muted-foreground">Recto</div>
                <div className="mt-1">Décris le tableau de : {condition.trim()}</div>
                <div className="mt-2 text-xs font-medium text-muted-foreground">Verso</div>
                <ul className="mt-1 space-y-1 text-muted-foreground">
                  {epidemiology.trim() && (
                    <li>
                      <span className="font-medium text-foreground">Épidémiologie :</span>{" "}
                      {epidemiology.trim()}
                    </li>
                  )}
                  {pathophysiology.trim() && (
                    <li>
                      <span className="font-medium text-foreground">Physiopathologie :</span>{" "}
                      {pathophysiology.trim()}
                    </li>
                  )}
                  {clinical.trim() && (
                    <li>
                      <span className="font-medium text-foreground">Clinique :</span>{" "}
                      {clinical.trim()}
                    </li>
                  )}
                  {management.trim() && (
                    <li>
                      <span className="font-medium text-foreground">Prise en charge :</span>{" "}
                      {management.trim()}
                    </li>
                  )}
                </ul>
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="refutation" className="space-y-4">
          <p className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
            Carte de réfutation (<em>refutation text</em>, Tippett 2010) : confronte une idée fausse
            à la réalité pour déloger une conception erronée.
          </p>
          <div className="space-y-2">
            <Label htmlFor="refutation-misconception">Idée fausse (la conception erronée)</Label>
            <Textarea
              id="refutation-misconception"
              ref={misconceptionRef}
              value={misconception}
              onChange={(e) => setMisconception(e.target.value)}
              onKeyDown={handleEditorKeyDown}
              rows={3}
              placeholder="Les saisons sont dues à la distance Terre-Soleil."
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="refutation-correct">Correction (l'énoncé correct)</Label>
            <Textarea
              id="refutation-correct"
              value={correct}
              onChange={(e) => setCorrect(e.target.value)}
              onKeyDown={handleEditorKeyDown}
              rows={3}
              placeholder="Les saisons sont dues à l'inclinaison de l'axe terrestre."
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="refutation-explanation">Explication (optionnel)</Label>
            <Textarea
              id="refutation-explanation"
              value={explanation}
              onChange={(e) => setExplanation(e.target.value)}
              onKeyDown={handleEditorKeyDown}
              rows={3}
              placeholder="L'orbite est quasi circulaire ; c'est l'angle d'incidence des rayons qui varie."
            />
          </div>
          {(misconception.trim() || correct.trim()) && (
            <div className="space-y-2">
              <Label>Aperçu de la carte</Label>
              <div className="rounded-md border p-3 text-sm">
                <div className="text-xs font-medium text-muted-foreground">Recto</div>
                <div className="mt-1">Vrai ou faux ? {misconception.trim() || "…"}</div>
                <div className="mt-2 text-xs font-medium text-muted-foreground">Verso</div>
                <div className="mt-1">
                  <span className="font-semibold text-destructive">FAUX.</span>{" "}
                  {correct.trim() || "…"}
                </div>
                {explanation.trim() && (
                  <p className="mt-1 text-muted-foreground">{explanation.trim()}</p>
                )}
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="worked_example" className="space-y-4">
          <p className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
            Exemple résolu progressif (<em>faded worked example</em>, Sweller/Renkl/Atkinson 2003) :
            l'énoncé s'affiche au recto ; au verso les étapes se révèlent une à une (l'apprenant
            prédit chacune) avant la réponse finale.
          </p>
          <div className="space-y-2">
            <Label htmlFor="we-problem">Problème (énoncé)</Label>
            <Textarea
              id="we-problem"
              ref={problemRef}
              value={problem}
              onChange={(e) => setProblem(e.target.value)}
              onKeyDown={handleEditorKeyDown}
              rows={3}
              placeholder="Résoudre l'équation 2x + 3 = 11."
            />
          </div>
          <div className="space-y-2">
            <Label>Étapes de résolution</Label>
            <div className="space-y-2">
              {steps.map((step, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional and reorder-free
                <div key={`step-${index}`} className="flex items-start gap-2">
                  <span className="mt-2.5 w-5 shrink-0 text-right text-xs font-medium tabular-nums text-muted-foreground">
                    {index + 1}.
                  </span>
                  <Textarea
                    value={step}
                    onChange={(e) => updateStep(index, e.target.value)}
                    onKeyDown={handleEditorKeyDown}
                    rows={2}
                    placeholder={
                      index === 0 ? "Soustraire 3 des deux côtés : 2x = 8" : "Étape suivante…"
                    }
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="mt-1 h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                    aria-label={`Retirer l'étape ${index + 1}`}
                    onClick={() => removeStep(index)}
                    disabled={steps.length <= 1}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
            <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={addStep}>
              <Plus className="h-3.5 w-3.5" />
              Ajouter une étape
            </Button>
          </div>
          <div className="space-y-2">
            <Label htmlFor="we-answer">Réponse finale</Label>
            <Input
              id="we-answer"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="x = 4"
            />
          </div>
          {(problem.trim() || answer.trim()) && (
            <div className="space-y-2">
              <Label>Aperçu de la carte</Label>
              <div className="rounded-md border p-3 text-sm">
                <div className="text-xs font-medium text-muted-foreground">Recto</div>
                <div className="mt-1">{problem.trim() || "…"}</div>
                <div className="mt-2 text-xs font-medium text-muted-foreground">
                  Verso (révélé progressivement)
                </div>
                <ol className="mt-1 list-decimal space-y-1 pl-5 text-muted-foreground">
                  {steps
                    .map((s) => s.trim())
                    .filter((s) => s.length > 0)
                    .map((s, i) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: preview rows are positional
                      <li key={`preview-step-${i}`}>{s}</li>
                    ))}
                </ol>
                <div className="mt-2">
                  <span className="font-semibold text-foreground">Réponse :</span>{" "}
                  {answer.trim() || "…"}
                </div>
              </div>
            </div>
          )}
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
