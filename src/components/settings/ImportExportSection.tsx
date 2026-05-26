/**
 * Settings → "Données". JSON import + export of the Mnemosys collection.
 *
 * Wave C2 ships only the JSON round-trip. The `.apkg` importer is deferred
 * to Session 2 and not wired here. The component is intentionally
 * self-contained so it can drop into the settings page maintained by
 * agent C3 without touching the route's other sections.
 *
 * Behaviour summary:
 *   - **Export**: shows one checkbox per deck plus a "tout sélectionner"
 *     toggle. The "Exporter" button opens a native save dialog through
 *     `@tauri-apps/plugin-dialog`, then streams the chosen decks to disk
 *     via `useExportJson()`.
 *   - **Import**: opens a native open dialog filtered to `.json`. The
 *     selected file is fed to `useImportJson()` which mints fresh deck /
 *     note / card rows. Decks whose name already exists are skipped and
 *     surfaced in the success toast.
 *
 * The component degrades gracefully in test / browser contexts where the
 * Tauri dialog API isn't injected (it shows an inline error toast).
 */

import { open, save } from "@tauri-apps/plugin-dialog";
import { Download, Loader2, Upload } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/use-toast";
import { useDecks, useExportJson, useImportJson } from "@/lib/queries";

/**
 * Build the default filename used by the save dialog — easy for the user
 * to grep / sort by date.
 */
function defaultExportFilename(): string {
  const today = new Date().toISOString().slice(0, 10);
  return `mnemosys-export-${today}.json`;
}

export function ImportExportSection() {
  const decksQuery = useDecks();
  const decks = useMemo(() => decksQuery.data ?? [], [decksQuery.data]);

  const exportMut = useExportJson();
  const importMut = useImportJson();

  // Selection state for the export sub-section. We start empty so a stray
  // click on the export button can't accidentally dump the whole DB.
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const allSelected = decks.length > 0 && selectedIds.size === decks.length;
  const noneSelected = selectedIds.size === 0;

  function toggleDeck(deckId: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(deckId)) {
        next.delete(deckId);
      } else {
        next.add(deckId);
      }
      return next;
    });
  }

  function toggleAll() {
    setSelectedIds((prev) =>
      prev.size === decks.length ? new Set() : new Set(decks.map((d) => d.id)),
    );
  }

  async function handleExport(deckIds: number[]) {
    if (deckIds.length === 0) return;
    try {
      const path = await save({
        defaultPath: defaultExportFilename(),
        filters: [{ name: "Mnemosys Export", extensions: ["json"] }],
      });
      if (!path) return; // user cancelled
      const count = await exportMut.mutateAsync({ deckIds, path });
      const fileLabel = path.split(/[/\\]/).pop() ?? path;
      toast({
        title: "Export réussi",
        description: `${count} note${count > 1 ? "s" : ""} exportée${count > 1 ? "s" : ""} dans ${fileLabel}.`,
      });
    } catch (err) {
      toast({
        title: "Export impossible",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  }

  async function handleImport() {
    try {
      const picked = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "Mnemosys Export", extensions: ["json"] }],
      });
      if (!picked) return; // user cancelled
      const path = typeof picked === "string" ? picked : picked[0];
      if (!path) return;
      const report = await importMut.mutateAsync({ path });

      const parts = [
        `${report.decks_imported} deck${report.decks_imported > 1 ? "s" : ""}`,
        `${report.notes_imported} note${report.notes_imported > 1 ? "s" : ""}`,
      ];
      if (report.cards_created > 0) {
        parts.push(`${report.cards_created} carte${report.cards_created > 1 ? "s" : ""}`);
      }
      const skippedSuffix =
        report.skipped_decks.length > 0
          ? ` (${report.skipped_decks.length} deck${report.skipped_decks.length > 1 ? "s" : ""} ignoré${report.skipped_decks.length > 1 ? "s" : ""} : ${report.skipped_decks.join(", ")})`
          : "";
      toast({
        title: "Import terminé",
        description: `${parts.join(", ")} importé(s)${skippedSuffix}.`,
      });
    } catch (err) {
      toast({
        title: "Import impossible",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Données</CardTitle>
        <CardDescription>
          Exporte ou importe tes decks au format JSON Mnemosys. L'historique de révision n'est pas
          inclus.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-8">
        {/* ---- Export sub-section ---- */}
        <section aria-labelledby="io-export-heading" className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 id="io-export-heading" className="text-sm font-semibold">
              Exporter
            </h3>
            {decks.length > 0 ? (
              <button
                type="button"
                className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                onClick={toggleAll}
              >
                {allSelected ? "Tout désélectionner" : "Tout sélectionner"}
              </button>
            ) : null}
          </div>

          {decksQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Chargement des decks…</p>
          ) : decks.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun deck à exporter pour le moment.</p>
          ) : (
            <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-md border bg-muted/30 p-3">
              {decks.map((deck) => {
                const checked = selectedIds.has(deck.id);
                return (
                  <Label
                    key={deck.id}
                    htmlFor={`io-deck-${deck.id}`}
                    className="flex cursor-pointer items-center gap-3 rounded px-2 py-1.5 hover:bg-background"
                  >
                    <input
                      id={`io-deck-${deck.id}`}
                      type="checkbox"
                      className="h-4 w-4 rounded border-input accent-primary"
                      checked={checked}
                      onChange={() => toggleDeck(deck.id)}
                    />
                    <span
                      aria-hidden="true"
                      className="inline-block h-3 w-3 rounded-full"
                      style={{ background: deck.color }}
                    />
                    <span className="truncate text-sm">{deck.name}</span>
                  </Label>
                );
              })}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              onClick={() => handleExport([...selectedIds])}
              disabled={noneSelected || exportMut.isPending || decks.length === 0}
            >
              {exportMut.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              Exporter la sélection
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleExport(decks.map((d) => d.id))}
              disabled={decks.length === 0 || exportMut.isPending}
            >
              Tout exporter
            </Button>
          </div>
        </section>

        {/* ---- Import sub-section ---- */}
        <section aria-labelledby="io-import-heading" className="space-y-3">
          <h3 id="io-import-heading" className="text-sm font-semibold">
            Importer
          </h3>
          <p className="text-xs text-muted-foreground">
            Choisis un fichier <code>.json</code> exporté depuis Mnemosys. Les decks dont le nom
            existe déjà localement seront ignorés (aucune fusion automatique).
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={handleImport}
            disabled={importMut.isPending}
          >
            {importMut.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            Importer un fichier Mnemosys (.json)
          </Button>
        </section>
      </CardContent>
    </Card>
  );
}
