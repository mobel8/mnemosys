/**
 * Study Planner page (Vague 21 — Implementation Intentions, Gollwitzer 1999).
 *
 * Lets the learner author « si [moment/lieu] alors j'étudie » plans. Time
 * plans are surfaced as local notifications at their cued moment (see
 * `src/lib/notifications.ts`); place / habit plans are commitment reminders
 * the learner reads here. The whole feature rests on one robust finding: an
 * implementation intention roughly doubles the rate at which a goal intention
 * turns into action (Gollwitzer & Sheeran 2006 meta, d ≈ 0.65).
 */

import { AlarmClock, CalendarClock, Pencil, Plus, Trash2, X } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/use-toast";
import {
  useCreatePlan,
  useDecks,
  useDeletePlan,
  usePlans,
  useTogglePlan,
  useUpdatePlan,
} from "@/lib/queries";
import type { PlanTriggerType, StudyPlan } from "@/lib/tauri";

/** Parse a plan's `days` JSON string into an ISO-weekday array; `[]` on garbage. */
function parseDays(days: string): number[] {
  try {
    const raw = JSON.parse(days);
    return Array.isArray(raw) ? (raw as number[]) : [];
  } catch {
    return [];
  }
}

/** ISO weekday labels for the day picker (`1`=Mon … `7`=Sun). */
const WEEKDAYS: { iso: number; label: string }[] = [
  { iso: 1, label: "L" },
  { iso: 2, label: "M" },
  { iso: 3, label: "M" },
  { iso: 4, label: "J" },
  { iso: 5, label: "V" },
  { iso: 6, label: "S" },
  { iso: 7, label: "D" },
];

const TRIGGER_LABELS: Record<PlanTriggerType, string> = {
  time: "Heure",
  place: "Lieu",
  after_habit: "Après une habitude",
};

/** Human phrasing of a trigger for the plan list. */
function describeTrigger(plan: StudyPlan): string {
  switch (plan.trigger_type) {
    case "time":
      return `à ${plan.trigger_value}`;
    case "place":
      return `au lieu « ${plan.trigger_value} »`;
    case "after_habit":
      return `${plan.trigger_value}`;
  }
}

/** Render the active weekdays of a plan, or « tous les jours » when empty. */
function describeDays(days: string): string {
  let parsed: number[] = [];
  try {
    const raw = JSON.parse(days);
    if (Array.isArray(raw)) parsed = raw as number[];
  } catch {
    // treat malformed as every day
  }
  if (parsed.length === 0) return "tous les jours";
  return parsed
    .slice()
    .sort((a, b) => a - b)
    .map((iso) => WEEKDAYS.find((w) => w.iso === iso)?.label ?? "?")
    .join(" ");
}

export default function PlannerPage() {
  const plans = usePlans();
  const decks = useDecks();
  const createPlan = useCreatePlan();
  const updatePlan = useUpdatePlan();
  const togglePlan = useTogglePlan();
  const deletePlan = useDeletePlan();

  // --- form state ---
  // `editingId` is `null` in create mode, or the id of the plan being edited.
  const [editingId, setEditingId] = useState<number | null>(null);
  const [triggerType, setTriggerType] = useState<PlanTriggerType>("time");
  const [triggerValue, setTriggerValue] = useState("19:00");
  const [action, setAction] = useState("");
  const [deckId, setDeckId] = useState<number | null>(null);
  const [selectedDays, setSelectedDays] = useState<number[]>([]);

  function toggleDay(iso: number) {
    setSelectedDays((prev) =>
      prev.includes(iso) ? prev.filter((d) => d !== iso) : [...prev, iso],
    );
  }

  /** Reset to a sensible default for the chosen trigger type. */
  function onTriggerTypeChange(next: PlanTriggerType) {
    setTriggerType(next);
    setTriggerValue(next === "time" ? "19:00" : "");
  }

  /** Clear the form back to create-mode defaults. */
  function resetForm() {
    setEditingId(null);
    setTriggerType("time");
    setTriggerValue("19:00");
    setAction("");
    setDeckId(null);
    setSelectedDays([]);
  }

  /** Load an existing plan into the form for editing. */
  function startEdit(plan: StudyPlan) {
    setEditingId(plan.id);
    setTriggerType(plan.trigger_type);
    setTriggerValue(plan.trigger_value);
    setAction(plan.action);
    setDeckId(plan.deck_id);
    setSelectedDays(parseDays(plan.days));
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (action.trim().length === 0) {
      toast({ title: "Décris l'action à réaliser.", variant: "destructive" });
      return;
    }
    if (triggerValue.trim().length === 0) {
      toast({ title: "Renseigne le déclencheur.", variant: "destructive" });
      return;
    }

    if (editingId !== null) {
      // Preserve the plan's current `enabled` flag across an edit; the Switch
      // in the list stays the source of truth for activation.
      const enabled = plans.data?.find((p) => p.id === editingId)?.enabled ?? true;
      updatePlan.mutate(
        {
          id: editingId,
          triggerType,
          triggerValue: triggerValue.trim(),
          action: action.trim(),
          deckId,
          days: JSON.stringify(selectedDays),
          enabled,
        },
        {
          onSuccess: () => {
            toast({ title: "Intention mise à jour." });
            resetForm();
          },
          onError: (err) =>
            toast({ title: "Échec", description: String(err), variant: "destructive" }),
        },
      );
      return;
    }

    createPlan.mutate(
      {
        triggerType,
        triggerValue: triggerValue.trim(),
        action: action.trim(),
        deckId,
        days: JSON.stringify(selectedDays),
        enabled: true,
      },
      {
        onSuccess: () => {
          toast({ title: "Intention enregistrée." });
          setAction("");
          setSelectedDays([]);
        },
        onError: (err) =>
          toast({ title: "Échec", description: String(err), variant: "destructive" }),
      },
    );
  }

  const rows = plans.data ?? [];
  const isEditing = editingId !== null;
  const submitting = createPlan.isPending || updatePlan.isPending;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <header>
        <h1 className="flex items-center gap-2 font-display text-2xl font-semibold tracking-tight">
          <CalendarClock className="h-6 w-6 text-brand-500" /> Planning
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Les intentions d'implémentation (« si X alors Y ») doublent la probabilité de passage à
          l'action (Gollwitzer 1999, d=0.65). Choisis un déclencheur concret et l'action de révision
          que tu y associes.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {isEditing ? "Modifier l'intention" : "Nouvelle intention"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="trigger-type">Quand je…</Label>
                <Select
                  value={triggerType}
                  onValueChange={(v) => onTriggerTypeChange(v as PlanTriggerType)}
                >
                  <SelectTrigger id="trigger-type" aria-label="Type de déclencheur">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="time">{TRIGGER_LABELS.time}</SelectItem>
                    <SelectItem value="place">{TRIGGER_LABELS.place}</SelectItem>
                    <SelectItem value="after_habit">{TRIGGER_LABELS.after_habit}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label htmlFor="trigger-value">
                  {triggerType === "time" ? "Heure" : triggerType === "place" ? "Lieu" : "Habitude"}
                </Label>
                <Input
                  id="trigger-value"
                  type={triggerType === "time" ? "time" : "text"}
                  placeholder={
                    triggerType === "place"
                      ? "bureau, bibliothèque…"
                      : triggerType === "after_habit"
                        ? "après le café du matin"
                        : undefined
                  }
                  value={triggerValue}
                  onChange={(e) => setTriggerValue(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="action">…alors j'étudie</Label>
              <Input
                id="action"
                placeholder="Réviser le deck Espagnol 15 min"
                value={action}
                onChange={(e) => setAction(e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="deck">Deck (optionnel)</Label>
              <Select
                value={deckId === null ? "none" : String(deckId)}
                onValueChange={(v) => setDeckId(v === "none" ? null : Number(v))}
              >
                <SelectTrigger id="deck" aria-label="Deck associé">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Aucun —</SelectItem>
                  {(decks.data ?? []).map((d) => (
                    <SelectItem key={d.id} value={String(d.id)}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <fieldset className="space-y-1">
              <legend className="text-sm font-medium">Jours (aucun = tous les jours)</legend>
              <div className="flex gap-1">
                {WEEKDAYS.map((w, idx) => {
                  const active = selectedDays.includes(w.iso);
                  return (
                    <Button
                      // weekday labels repeat (M/M), so key on the ISO index
                      key={w.iso}
                      type="button"
                      variant={active ? "default" : "outline"}
                      size="sm"
                      className="h-9 w-9 p-0"
                      aria-pressed={active}
                      aria-label={`Jour ${idx + 1}`}
                      onClick={() => toggleDay(w.iso)}
                    >
                      {w.label}
                    </Button>
                  );
                })}
              </div>
            </fieldset>

            <div className="flex items-center gap-2">
              <Button type="submit" disabled={submitting} className="gap-2">
                {isEditing ? (
                  <>
                    <Pencil className="h-4 w-4" /> Enregistrer les modifications
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4" /> Ajouter l'intention
                  </>
                )}
              </Button>
              {isEditing && (
                <Button type="button" variant="ghost" className="gap-2" onClick={resetForm}>
                  <X className="h-4 w-4" /> Annuler
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground/70">
          Mes intentions
        </h3>
        {plans.isLoading ? (
          <ul className="space-y-2">
            {[0, 1, 2].map((i) => (
              <li
                key={`plan-skeleton-${i}`}
                className="flex items-center gap-3 rounded-xl border bg-card p-3 shadow-sm"
              >
                <div className="h-4 w-4 shrink-0 animate-pulse rounded-full bg-muted" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="h-3.5 w-2/3 animate-pulse rounded-lg bg-muted" />
                  <div className="h-3 w-1/3 animate-pulse rounded-lg bg-muted" />
                </div>
                <div className="h-5 w-9 shrink-0 animate-pulse rounded-full bg-muted" />
              </li>
            ))}
          </ul>
        ) : rows.length === 0 ? (
          <Card className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-500">
              <CalendarClock className="h-7 w-7" />
            </div>
            <p className="font-display text-lg font-semibold tracking-tight">
              Aucune intention pour l'instant
            </p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Associe un déclencheur concret à une action de révision dans le formulaire ci-dessus
              pour passer plus souvent à l'action.
            </p>
          </Card>
        ) : (
          <ul className="space-y-2">
            {rows.map((plan) => (
              <li
                key={plan.id}
                className={`flex items-center gap-3 rounded-xl border bg-card p-3 shadow-sm transition-shadow hover:shadow-md ${
                  editingId === plan.id ? "ring-2 ring-ring" : ""
                }`}
              >
                {plan.trigger_type === "time" ? (
                  <AlarmClock className="h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                  <CalendarClock className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{plan.action}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    Quand je {describeTrigger(plan)} · {describeDays(plan.days)}
                  </p>
                </div>
                <Switch
                  checked={plan.enabled}
                  aria-label={plan.enabled ? "Désactiver" : "Activer"}
                  onCheckedChange={(checked) =>
                    togglePlan.mutate({ id: plan.id, enabled: checked })
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Modifier"
                  onClick={() => startEdit(plan)}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Supprimer"
                  onClick={() =>
                    deletePlan.mutate(plan.id, {
                      onSuccess: () => {
                        toast({ title: "Intention supprimée." });
                        // If we were editing the plan we just deleted, drop the form.
                        if (editingId === plan.id) resetForm();
                      },
                    })
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
