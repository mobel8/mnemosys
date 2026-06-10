/**
 * Self-contained import panel: JSON Mnemosys, Anki `.apkg` and `.srt`/`.vtt`
 * subtitle files. Zero props — it owns its queries (`useDecks`) and mutations,
 * so it can be dropped both into Settings → « Données » (via
 * `<ImportExportSection>`) and into the « Créer » hub.
 *
 * Behaviour summary:
 *   - **Import JSON**: native open dialog filtered to `.json`; the file is fed
 *     to `useImportJson()` which mints fresh deck / note / card rows. v2
 *     exports also carry the FSRS state + review history, restored verbatim.
 *     Decks whose name already exists are skipped and listed in the toast.
 *   - **Import .apkg**: same flow through `useImportApkg()`.
 *   - **Subtitles**: turns a `.srt`/`.vtt` file into sentence cards inside a
 *     target deck (basic or auto-cloze mode).
 *
 * The component degrades gracefully in test / browser contexts where the
 * Tauri dialog API isn't injected (it shows an inline error toast).
 */

import { open } from "@tauri-apps/plugin-dialog";
import { Captions, ChevronDown, FileArchive, Loader2, Upload } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/use-toast";
import { useDecks, useImportApkg, useImportJson, useImportSubtitles } from "@/lib/queries";
import type { SubtitleMode } from "@/lib/tauri";

// Native <select> kept here (not the Radix primitive) because the locked unit
// tests drive it via `user.selectOptions` / `getByRole("option")`, which only
// work on a real <select>. Styled to mirror `ui/select.tsx`'s trigger voice so
// it reads as part of the same design system.
const SELECT_CLASS =
  "flex h-9 w-full cursor-pointer appearance-none rounded-lg border border-input bg-card px-3 py-2 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50";

export function ImportPanel() {
  const decksQuery = useDecks();
  const decks = useMemo(() => decksQuery.data ?? [], [decksQuery.data]);

  const importMut = useImportJson();
  const importApkgMut = useImportApkg();
  const importSubsMut = useImportSubtitles();

  // Subtitle-import controls: which deck receives the cues and in what mode.
  const [subsDeckId, setSubsDeckId] = useState<number | null>(null);
  const [subsMode, setSubsMode] = useState<SubtitleMode>("sentence");

  // Default the subtitle target deck to the first available one once decks
  // load, so the user isn't forced to touch the dropdown for the common case.
  useEffect(() => {
    const first = decks[0];
    if (subsDeckId === null && first) {
      setSubsDeckId(first.id);
    }
  }, [decks, subsDeckId]);

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

  async function handleImportApkg() {
    try {
      const picked = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "Anki Package", extensions: ["apkg"] }],
      });
      if (!picked) return;
      const path = typeof picked === "string" ? picked : picked[0];
      if (!path) return;
      const report = await importApkgMut.mutateAsync({ path });

      const { stats, skipped_decks } = report;
      const parts = [
        `${stats.decks_imported} deck${stats.decks_imported > 1 ? "s" : ""}`,
        `${stats.notes_imported} note${stats.notes_imported > 1 ? "s" : ""}`,
      ];
      const droppedBits: string[] = [];
      if (stats.notes_skipped > 0) {
        droppedBits.push(
          `${stats.notes_skipped} note${stats.notes_skipped > 1 ? "s" : ""} ignorée${stats.notes_skipped > 1 ? "s" : ""}`,
        );
      }
      if (stats.cards_skipped_no_anki_card > 0) {
        droppedBits.push(`${stats.cards_skipped_no_anki_card} orphelin(s)`);
      }
      if (skipped_decks.length > 0) {
        droppedBits.push(
          `${skipped_decks.length} deck${skipped_decks.length > 1 ? "s" : ""} déjà existant${skipped_decks.length > 1 ? "s" : ""} : ${skipped_decks.join(", ")}`,
        );
      }
      const droppedSuffix = droppedBits.length > 0 ? ` — ${droppedBits.join(" · ")}` : "";
      toast({
        title: "Import Anki terminé",
        description: `${parts.join(", ")} importé(s)${droppedSuffix}.`,
      });
    } catch (err) {
      toast({
        title: "Import Anki impossible",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  }

  async function handleImportSubtitles() {
    if (subsDeckId === null) {
      toast({
        title: "Aucun deck sélectionné",
        description: "Choisis d'abord le deck qui recevra les cartes.",
        variant: "destructive",
      });
      return;
    }
    try {
      const picked = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "Sous-titres", extensions: ["srt", "vtt"] }],
      });
      if (!picked) return;
      const path = typeof picked === "string" ? picked : picked[0];
      if (!path) return;
      const report = await importSubsMut.mutateAsync({ path, deckId: subsDeckId, mode: subsMode });

      const skippedSuffix =
        report.skipped_empty > 0
          ? ` (${report.skipped_empty} ignorée${report.skipped_empty > 1 ? "s" : ""})`
          : "";
      toast({
        title: "Sous-titres importés",
        description: `${report.cues_parsed} réplique${report.cues_parsed > 1 ? "s" : ""} → ${report.notes_created} carte${report.notes_created > 1 ? "s" : ""}${skippedSuffix}.`,
      });
    } catch (err) {
      toast({
        title: "Import des sous-titres impossible",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  }

  return (
    <div className="space-y-8">
      {/* ---- File imports (JSON Mnemosys + .apkg Anki) ---- */}
      <section aria-labelledby="io-import-heading" className="space-y-3">
        <h3 id="io-import-heading" className="text-sm font-semibold">
          Importer
        </h3>
        <p className="text-xs text-muted-foreground">
          Choisis un fichier <code>.json</code> exporté depuis Mnemosys. Les decks dont le nom
          existe déjà localement seront ignorés (aucune fusion automatique).
        </p>
        <div className="flex flex-wrap items-center gap-2">
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
          <Button
            type="button"
            variant="outline"
            onClick={handleImportApkg}
            disabled={importApkgMut.isPending}
          >
            {importApkgMut.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileArchive className="h-4 w-4" />
            )}
            Importer un paquet Anki (.apkg)
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          L'import Anki crée de nouveaux decks. L'historique de révision Anki n'est pas conservé
          (les cartes repartent à l'état « nouvelle »).
        </p>
      </section>

      {/* ---- Subtitle import (sentence mining) ---- */}
      <section aria-labelledby="io-subs-heading" className="space-y-3">
        <h3 id="io-subs-heading" className="text-sm font-semibold">
          Sous-titres (sentence mining)
        </h3>
        <p className="text-xs text-muted-foreground">
          Transforme un fichier <code>.srt</code> ou <code>.vtt</code> en cartes phrase. Chaque
          réplique devient une carte dans le deck choisi.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="io-subs-deck" className="text-xs">
              Deck cible
            </Label>
            <div className="relative">
              <select
                id="io-subs-deck"
                className={SELECT_CLASS}
                value={subsDeckId ?? ""}
                onChange={(e) => setSubsDeckId(e.target.value ? Number(e.target.value) : null)}
                disabled={decks.length === 0}
              >
                {decks.length === 0 ? (
                  <option value="">Aucun deck disponible</option>
                ) : (
                  decks.map((deck) => (
                    <option key={deck.id} value={deck.id}>
                      {deck.name}
                    </option>
                  ))
                )}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-60" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="io-subs-mode" className="text-xs">
              Mode
            </Label>
            <div className="relative">
              <select
                id="io-subs-mode"
                className={SELECT_CLASS}
                value={subsMode}
                onChange={(e) => setSubsMode(e.target.value as SubtitleMode)}
              >
                <option value="sentence">Phrase basique (recto / verso)</option>
                <option value="cloze">Cloze auto (mot le plus long)</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-60" />
            </div>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={handleImportSubtitles}
          disabled={importSubsMut.isPending || decks.length === 0}
        >
          {importSubsMut.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Captions className="h-4 w-4" />
          )}
          Importer des sous-titres (.srt/.vtt)
        </Button>
      </section>
    </div>
  );
}
