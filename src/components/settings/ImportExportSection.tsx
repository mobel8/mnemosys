/**
 * Settings → "Données". Export of the Mnemosys collection + every import
 * path (delegated to the self-contained `<ImportPanel>`, which is also reused
 * by the « Créer » hub).
 *
 * Behaviour summary:
 *   - **Export**: shows one checkbox per deck plus a "tout sélectionner"
 *     toggle. The "Exporter" button opens a native save dialog through
 *     `@tauri-apps/plugin-dialog`, then streams the chosen decks to disk
 *     via `useExportJson()`. The v2 format includes the FSRS state of every
 *     card and the full review history, so progress survives a round-trip.
 *   - **Imports**: see `./ImportPanel.tsx` (JSON Mnemosys, Anki `.apkg`,
 *     `.srt`/`.vtt` subtitles).
 *
 * The component degrades gracefully in test / browser contexts where the
 * Tauri dialog API isn't injected (it shows an inline error toast).
 */

import { save } from "@tauri-apps/plugin-dialog";
import { Download, FileArchive, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { ImportPanel } from "@/components/settings/ImportPanel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/use-toast";
import { useDecks, useExportJson } from "@/lib/queries";

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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Données</CardTitle>
        <CardDescription>
          Exporte ou importe tes decks au format JSON Mnemosys. L'export inclut l'état de
          planification des cartes et l'historique de révision.
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
            <div
              className="space-y-1.5 rounded-lg border bg-muted/30 p-3"
              role="status"
              aria-busy="true"
              aria-label="Chargement des decks"
            >
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-3 px-2 py-1.5">
                  <div className="h-4 w-4 shrink-0 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-3 shrink-0 animate-pulse rounded-full bg-muted" />
                  <div className="h-4 w-32 animate-pulse rounded-lg bg-muted" />
                </div>
              ))}
            </div>
          ) : decks.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-muted/30 px-6 py-8 text-center">
              <FileArchive className="h-7 w-7 text-brand-500" />
              <p className="font-display text-sm font-semibold tracking-tight">Aucun deck</p>
              <p className="text-xs text-muted-foreground">
                Crée ou importe un deck pour pouvoir l'exporter.
              </p>
            </div>
          ) : (
            <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-lg border bg-muted/30 p-3">
              {decks.map((deck) => {
                const checked = selectedIds.has(deck.id);
                return (
                  <Label
                    key={deck.id}
                    htmlFor={`io-deck-${deck.id}`}
                    className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-background"
                  >
                    <input
                      id={`io-deck-${deck.id}`}
                      type="checkbox"
                      className="h-4 w-4 rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                      checked={checked}
                      onChange={() => toggleDeck(deck.id)}
                    />
                    <span
                      aria-hidden="true"
                      className="inline-block h-3 w-3 shrink-0 rounded-full"
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

        {/* ---- Imports (shared with the « Créer » hub) ---- */}
        <ImportPanel />
      </CardContent>
    </Card>
  );
}
