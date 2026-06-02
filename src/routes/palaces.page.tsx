/**
 * Memory Palaces index — list of palaces with a "New palace" call to
 * action. Each tile links to `/palaces/$palaceId` for editing and carries an
 * action menu (rename / delete) mirroring `DeckCard`.
 */

import { Link } from "@tanstack/react-router";
import { Compass, MapPin, MoreVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";
import { useCreatePalace, useDeletePalace, usePalaces, useUpdatePalace } from "@/lib/queries";
import type { Palace, PalaceTemplate } from "@/lib/tauri";

const TEMPLATES: Array<{ id: PalaceTemplate; label: string; hint: string }> = [
  { id: "house", label: "Maison", hint: "3 pièces avec cloisons internes." },
  { id: "street", label: "Rue", hint: "Couloir long avec colonnes régulières." },
  { id: "castle", label: "Château", hint: "Grande salle aux hauts murs." },
];

/** Human label for a template id; falls back to the raw value for « custom ». */
function templateLabel(template: PalaceTemplate): string {
  return TEMPLATES.find((t) => t.id === template)?.label ?? template;
}

export default function PalacesIndexPage() {
  const palaces = usePalaces();
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className="space-y-6 p-6">
      <header className="flex items-start justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Compass className="h-6 w-6 text-brand-500" /> Memory Palaces
          </h1>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            Place tes cartes sur des « loci » à l'intérieur d'un palace 3D et révise-les en mode
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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders, order is stable
            <div key={i} className="h-[88px] animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : palaces.data && palaces.data.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {palaces.data.map((p) => (
            <PalaceCard key={p.id} palace={p} />
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-500">
              <MapPin className="h-6 w-6" aria-hidden />
            </div>
            <h3 className="font-display text-lg font-semibold tracking-tight">
              Aucun palace pour l'instant
            </h3>
            <p className="max-w-sm text-sm text-muted-foreground">
              Crée ton premier palace pour épingler des cartes dans un espace 3D et les réviser en
              parcours.
            </p>
            <Button onClick={() => setDialogOpen(true)} className="mt-1 gap-2">
              <Plus className="h-4 w-4" /> Nouveau palace
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/**
 * One palace tile: the whole card links to the 3D editor, while the action
 * menu (rename / delete) sits in the top-right. The menu trigger stops click
 * propagation so opening it never navigates.
 */
function PalaceCard({ palace }: { palace: Palace }) {
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const deletePalace = useDeletePalace({
    onSuccess: () => {
      toast({ title: "Palace supprimé", description: `« ${palace.name} » a été supprimé.` });
      setConfirmDelete(false);
    },
    onError: (err) => {
      toast({
        title: "Suppression impossible",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  return (
    <>
      <Link to="/palaces/$palaceId" params={{ palaceId: palace.id }} className="group">
        <Card className="transition-shadow group-hover:shadow-md">
          <CardContent className="space-y-2 p-4">
            <div className="flex items-start justify-between gap-2">
              <h3 className="min-w-0 flex-1 truncate text-base font-medium leading-tight">
                {palace.name}
              </h3>
              <div className="flex shrink-0 items-center gap-1">
                <Badge variant="secondary">{templateLabel(palace.template)}</Badge>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 opacity-60 hover:opacity-100"
                      aria-label="Actions du palace"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                    >
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" onClick={(e) => e.preventDefault()}>
                    <DropdownMenuItem onSelect={() => setEditOpen(true)}>
                      <Pencil className="h-4 w-4" />
                      Renommer
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onSelect={() => setConfirmDelete(true)}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                      Supprimer
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
            {palace.description && (
              <p className="line-clamp-2 text-xs text-muted-foreground">{palace.description}</p>
            )}
          </CardContent>
        </Card>
      </Link>

      <EditPalaceDialog palace={palace} open={editOpen} onOpenChange={setEditOpen} />

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer « {palace.name} » ?</AlertDialogTitle>
            <AlertDialogDescription>
              Toutes les cartes épinglées sur ses loci seront détachées. Cette action est
              irréversible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                deletePalace.mutate(palace.id);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletePalace.isPending ? "Suppression…" : "Supprimer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** Dialog editing a palace's name / description / template via `useUpdatePalace`. */
function EditPalaceDialog({
  palace,
  open,
  onOpenChange,
}: {
  palace: Palace;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [name, setName] = useState(palace.name);
  const [description, setDescription] = useState(palace.description ?? "");
  const [template, setTemplate] = useState<PalaceTemplate>(palace.template);

  // Re-sync the form with the latest palace whenever the dialog is (re)opened,
  // so a cache update from elsewhere never leaves stale values behind.
  function syncFromPalace() {
    setName(palace.name);
    setDescription(palace.description ?? "");
    setTemplate(palace.template);
  }

  const update = useUpdatePalace({
    onSuccess: (p) => {
      toast({ title: "Palace mis à jour", description: `« ${p.name} » a été modifié.` });
      onOpenChange(false);
    },
    onError: (err) => {
      toast({ title: "Mise à jour impossible", description: err.message, variant: "destructive" });
    },
  });

  // The « custom » template has no preset button; keep it selectable as the
  // current value but don't expose it as a fresh choice.
  const choices: PalaceTemplate[] = TEMPLATES.map((t) => t.id);
  const showCustom = !choices.includes(template);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) syncFromPalace();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Modifier le palace</DialogTitle>
          <DialogDescription>
            Renomme ton palace, ajuste sa description ou change son template 3D.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="edit-palace-name">Nom</Label>
            <Input
              id="edit-palace-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ma maison d'enfance"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-palace-description">Description (optionnel)</Label>
            <Textarea
              id="edit-palace-description"
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
                  className={`rounded-lg border p-2 text-left text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                    template === t.id
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border hover:border-accent hover:bg-accent"
                  }`}
                >
                  <p className="font-medium">{t.label}</p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">{t.hint}</p>
                </button>
              ))}
            </div>
            {showCustom && (
              <p className="text-[10px] text-muted-foreground">
                Template actuel : « {template} » (personnalisé). Choisir un preset le remplacera.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button
            disabled={name.trim().length === 0 || update.isPending}
            onClick={() =>
              update.mutate({
                id: palace.id,
                name: name.trim(),
                description: description.trim() ? description.trim() : null,
                template,
              })
            }
          >
            {update.isPending ? "Enregistrement…" : "Enregistrer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
                  className={`rounded-lg border p-2 text-left text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                    template === t.id
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border hover:border-accent hover:bg-accent"
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
