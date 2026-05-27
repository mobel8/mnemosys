/**
 * Memory Palaces index — list of palaces with a "New palace" call to
 * action. Each tile links to `/palaces/$palaceId` for editing.
 */

import { Link } from "@tanstack/react-router";
import { Compass, MapPin, Plus } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";
import { useCreatePalace, usePalaces } from "@/lib/queries";
import type { PalaceTemplate } from "@/lib/tauri";

const TEMPLATES: Array<{ id: PalaceTemplate; label: string; hint: string }> = [
  { id: "house", label: "Maison", hint: "3 pièces avec cloisons internes." },
  { id: "street", label: "Rue", hint: "Couloir long avec colonnes régulières." },
  { id: "castle", label: "Château", hint: "Grande salle aux hauts murs." },
];

export default function PalacesIndexPage() {
  const palaces = usePalaces();
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className="space-y-6 p-6">
      <header className="flex items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Compass className="h-6 w-6" /> Memory Palaces
          </h2>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            Place tes cartes sur des « loci » à l'intérieur d'un palace 3D et réviseles en mode
            parcours. Inspiré de Krokos et al. 2019 (+8.8 % de rappel en VR vs liste plate) et des
            cellules de lieu (Nobel 2014, O'Keefe / Moser).
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" /> Nouveau palace
        </Button>
      </header>

      <CreatePalaceDialog open={dialogOpen} onOpenChange={setDialogOpen} />

      {palaces.isLoading ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : palaces.data && palaces.data.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {palaces.data.map((p) => (
            <Link key={p.id} to="/palaces/$palaceId" params={{ palaceId: p.id }} className="group">
              <Card className="transition-shadow group-hover:shadow-md">
                <CardContent className="space-y-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-base font-medium leading-tight">{p.name}</h3>
                    <Badge variant="secondary">{p.template}</Badge>
                  </div>
                  {p.description && (
                    <p className="line-clamp-2 text-xs text-muted-foreground">{p.description}</p>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center text-sm text-muted-foreground">
            <MapPin className="h-6 w-6" />
            Aucun palace pour l'instant — crée ton premier pour épingler des cartes en 3D.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function CreatePalaceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [template, setTemplate] = useState<PalaceTemplate>("house");
  const create = useCreatePalace({
    onSuccess: (p) => {
      toast({ title: "Palace créé", description: `« ${p.name} » est prêt.` });
      setName("");
      setDescription("");
      setTemplate("house");
      onOpenChange(false);
    },
    onError: (err) => {
      toast({ title: "Création impossible", description: err.message });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nouveau palace</DialogTitle>
          <DialogDescription>
            Donne un nom à ton palace et choisis un template 3D. Tu pourras ensuite y placer des
            cartes en mode édition.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="palace-name">Nom</Label>
            <Input
              id="palace-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ma maison d'enfance"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="palace-description">Description (optionnel)</Label>
            <Textarea
              id="palace-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description courte du parcours…"
              rows={2}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Template 3D</Label>
            <div className="grid grid-cols-3 gap-2">
              {TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTemplate(t.id)}
                  className={`rounded-md border p-2 text-left text-xs transition-colors ${
                    template === t.id
                      ? "border-primary bg-primary/10"
                      : "border-border hover:bg-accent/40"
                  }`}
                >
                  <p className="font-medium">{t.label}</p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">{t.hint}</p>
                </button>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button
            disabled={name.trim().length === 0 || create.isPending}
            onClick={() =>
              create.mutate({
                name: name.trim(),
                description: description.trim() ? description.trim() : null,
                template,
              })
            }
          >
            Créer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
