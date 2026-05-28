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
        <h2 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <CalendarClock className="h-6 w-6" /> Planning
        </h2>
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
                <select
                  id="trigger-type"
                  aria-label="Type de déclencheur"
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={triggerType}
                  onChange={(e) => onTriggerTypeChange(e.target.value as PlanTriggerType)}
                >
                  <option value="time">{TRIGGER_LABELS.time}</option>
                  <option value="place">{TRIGGER_LABELS.place}</option>
                  <option value="after_habit">{TRIGGER_LABELS.after_habit}</option>
                </select>
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
              <select
                id="deck"
                aria-label="Deck associé"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={deckId ?? ""}
                onChange={(e) => setDeckId(e.target.value === "" ? null : Number(e.target.value))}
              >
                <option value="">— Aucun —</option>
                {(decks.data ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
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
        <h3 className="text-sm font-semibold text-muted-foreground">Mes intentions</h3>
        {plans.isLoading ? (
          <p className="text-sm text-muted-foreground">Chargement…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aucune intention pour l'instant. Crée-en une ci-dessus.
          </p>
        ) : (
          <ul className="space-y-2">
            {rows.map((plan) => (
              <li
                key={plan.id}
                className={`flex items-center gap-3 rounded-md border bg-card/40 p-3 ${
                  editingId === plan.id ? "ring-1 ring-primary" : ""
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
