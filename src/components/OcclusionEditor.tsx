/**
 * Image-occlusion editor.
 *
 * Flow:
 *   1. The user picks an image from disk through `@tauri-apps/plugin-dialog`.
 *   2. We copy it into `<app_data_dir>/occlusion-media/` via the
 *      `copy_image_to_app_data` Tauri command and load it back through
 *      `convertFileSrc()` so the webview can render it (FS scope).
 *   3. The user draws rectangular masks on top of the image with the mouse.
 *      Each mask gets an optional `label` (the answer to recall).
 *   4. On submit we materialise one note with `template === "occlusion"` —
 *      `NoteRepo::create` then mints one card per mask.
 *
 * Coordinates are stored in *source-image pixel space*, not in display
 * pixels, so the same note renders correctly at any size. We persist
 * `natural_width` / `natural_height` alongside the masks so the review
 * surface can preserve aspect ratio without re-reading the file.
 *
 * Deliberately MVP: no drag-to-move existing masks, no resize handles, no
 * undo stack. The intended micro-workflow is "draw 5 masks, label them,
 * save" — anything richer can be added in a future pass.
 */

import { convertFileSrc } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ImagePlus, Trash2 } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/use-toast";
import { useCreateNote } from "@/lib/queries";
import { api, type OcclusionMask } from "@/lib/tauri";

interface OcclusionEditorProps {
  deckId: number;
  onSaved?: () => void;
}

/** Rectangle currently being drawn (in source-image pixel space). `null`
 *  when the user isn't dragging. */
interface DraftRect {
  startX: number;
  startY: number;
  curX: number;
  curY: number;
}

/** Editor-side mask with a stable React key. The `id` is dropped before we
 *  send the payload to Rust; the persisted shape is just `OcclusionMask`. */
interface EditorMask extends OcclusionMask {
  id: string;
}

let __maskIdSeq = 0;
function newMaskId(): string {
  __maskIdSeq += 1;
  return `m${__maskIdSeq}`;
}

/** Convert a screen-space mouse position into source-image pixel coordinates
 *  (clamped to the image bounds). */
function clientToImagePx(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  naturalW: number,
  naturalH: number,
): { x: number; y: number } {
  const dx = clientX - rect.left;
  const dy = clientY - rect.top;
  const scaleX = naturalW / rect.width;
  const scaleY = naturalH / rect.height;
  const x = Math.max(0, Math.min(naturalW, dx * scaleX));
  const y = Math.max(0, Math.min(naturalH, dy * scaleY));
  return { x, y };
}

/** Normalise a draft rect so width/height are positive (the user can drag
 *  from any corner). */
function draftToMask(draft: DraftRect): EditorMask {
  const x = Math.min(draft.startX, draft.curX);
  const y = Math.min(draft.startY, draft.curY);
  const width = Math.abs(draft.curX - draft.startX);
  const height = Math.abs(draft.curY - draft.startY);
  return { id: newMaskId(), x, y, width, height, label: "" };
}

/** Smallest mask we accept. Anything below is probably an accidental click. */
const MIN_MASK_PX = 6;

export function OcclusionEditor({ deckId, onSaved }: OcclusionEditorProps) {
  // Source image, once copied into app_data_dir.
  const [imagePath, setImagePath] = useState<string | null>(null);
  // Natural size — populated when the <img> loads.
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  // Confirmed masks (the ones the learner will see at review time). Each
  // carries an editor-local `id` so React keys are stable across reorders /
  // deletions; the id is stripped before we POST to the backend.
  const [masks, setMasks] = useState<EditorMask[]>([]);
  // Active drag, if any.
  const [draft, setDraft] = useState<DraftRect | null>(null);
  // True while the file picker / copy command is in flight, so we can disable
  // the upload button instead of letting the user spam it.
  const [picking, setPicking] = useState(false);

  const imgRef = useRef<HTMLImageElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const createNote = useCreateNote();

  const handlePick = useCallback(async () => {
    setPicking(true);
    try {
      const selected = await openDialog({
        multiple: false,
        directory: false,
        filters: [
          {
            name: "Image",
            extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp"],
          },
        ],
      });
      if (!selected) return;
      const src = typeof selected === "string" ? selected : selected;
      const copied = await api.media.copyImageToAppData(src);
      setImagePath(copied);
      setMasks([]);
      setDraft(null);
      setNatural(null);
    } catch (err) {
      toast({
        title: "Impossible de charger l'image",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setPicking(false);
    }
  }, []);

  const handleImageLoad = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    setNatural({ width: img.naturalWidth, height: img.naturalHeight });
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const img = imgRef.current;
      if (!img || !natural) return;
      // Only start drawing on left button.
      if (e.button !== 0) return;
      const rect = img.getBoundingClientRect();
      const { x, y } = clientToImagePx(e.clientX, e.clientY, rect, natural.width, natural.height);
      // Capture so we keep getting pointermove even if the cursor leaves the
      // <img> mid-drag (Tauri's webview reliably honours setPointerCapture).
      (e.target as Element).setPointerCapture?.(e.pointerId);
      setDraft({ startX: x, startY: y, curX: x, curY: y });
    },
    [natural],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draft) return;
      const img = imgRef.current;
      if (!img || !natural) return;
      const rect = img.getBoundingClientRect();
      const { x, y } = clientToImagePx(e.clientX, e.clientY, rect, natural.width, natural.height);
      setDraft({ ...draft, curX: x, curY: y });
    },
    [draft, natural],
  );

  const finalizeDraft = useCallback(() => {
    if (!draft) return;
    const mask = draftToMask(draft);
    setDraft(null);
    if (mask.width < MIN_MASK_PX || mask.height < MIN_MASK_PX) return;
    setMasks((prev) => [...prev, mask]);
  }, [draft]);

  const handlePointerUp = useCallback(() => {
    finalizeDraft();
  }, [finalizeDraft]);

  const updateLabel = useCallback((idx: number, label: string) => {
    setMasks((prev) => prev.map((m, i) => (i === idx ? { ...m, label } : m)));
  }, []);

  const removeMask = useCallback((idx: number) => {
    setMasks((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const handleSave = useCallback(() => {
    if (!imagePath || !natural) return;
    if (masks.length === 0) {
      toast({
        title: "Aucun masque",
        description: "Dessine au moins un rectangle avant de créer les cartes.",
        variant: "destructive",
      });
      return;
    }
    // Drop the editor-only `id` field before persisting — the Rust schema
    // only knows about `x`, `y`, `width`, `height`, `label`.
    const persistedMasks: OcclusionMask[] = masks.map(({ id: _id, ...rest }) => rest);
    createNote.mutate(
      {
        deckId,
        template: "occlusion",
        fields: {
          image_path: imagePath,
          natural_width: natural.width,
          natural_height: natural.height,
          masks: persistedMasks,
        },
        tags: [],
      },
      {
        onSuccess: () => {
          toast({
            title: "Cartes créées",
            description: `${masks.length} carte(s) d'image-occlusion ajoutée(s).`,
          });
          setImagePath(null);
          setMasks([]);
          setDraft(null);
          setNatural(null);
          onSaved?.();
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
  }, [createNote, deckId, imagePath, masks, natural, onSaved]);

  // The visual draft rectangle (the one being drawn). Rendered in display
  // pixels via `natural → display` scaling.
  const draftDisplay = (() => {
    if (!draft || !natural || !imgRef.current) return null;
    const rect = imgRef.current.getBoundingClientRect();
    const sx = rect.width / natural.width;
    const sy = rect.height / natural.height;
    const x = Math.min(draft.startX, draft.curX) * sx;
    const y = Math.min(draft.startY, draft.curY) * sy;
    const w = Math.abs(draft.curX - draft.startX) * sx;
    const h = Math.abs(draft.curY - draft.startY) * sy;
    return { x, y, w, h };
  })();

  return (
    <div className="space-y-4">
      {!imagePath && (
        <div className="rounded-md border border-dashed p-8 text-center">
          <p className="mb-3 text-sm text-muted-foreground">
            Choisis une image, dessine des rectangles sur les zones à masquer, puis crée tes cartes.
            Une carte sera générée par masque.
          </p>
          <Button type="button" onClick={() => void handlePick()} disabled={picking}>
            <ImagePlus className="h-4 w-4" />
            {picking ? "Chargement..." : "Choisir une image"}
          </Button>
        </div>
      )}

      {imagePath && (
        <>
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              Clique-glisse pour dessiner un masque.{" "}
              {natural ? `(${natural.width} × ${natural.height} px)` : ""}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handlePick()}
              disabled={picking}
            >
              Changer d'image
            </Button>
          </div>

          <div
            ref={wrapRef}
            className="relative max-h-[600px] w-full overflow-auto rounded-md border bg-muted/10"
          >
            <div
              className="relative inline-block select-none"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              style={{ touchAction: "none", cursor: natural ? "crosshair" : "wait" }}
            >
              <img
                ref={imgRef}
                src={convertFileSrc(imagePath)}
                alt="Source de l'occlusion"
                draggable={false}
                onLoad={handleImageLoad}
                className="block max-w-full"
              />
              {natural &&
                masks.map((m, idx) => {
                  const rect = imgRef.current?.getBoundingClientRect();
                  if (!rect) return null;
                  const sx = rect.width / natural.width;
                  const sy = rect.height / natural.height;
                  return (
                    <div
                      key={m.id}
                      className="pointer-events-none absolute border-2 border-dashed border-primary bg-primary/40"
                      style={{
                        left: m.x * sx,
                        top: m.y * sy,
                        width: m.width * sx,
                        height: m.height * sy,
                      }}
                    >
                      <span className="absolute -top-2 -left-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
                        {idx + 1}
                      </span>
                    </div>
                  );
                })}
              {draftDisplay && (
                <div
                  className="pointer-events-none absolute border-2 border-dashed border-primary/80 bg-primary/20"
                  style={{
                    left: draftDisplay.x,
                    top: draftDisplay.y,
                    width: draftDisplay.w,
                    height: draftDisplay.h,
                  }}
                />
              )}
            </div>
          </div>

          {masks.length > 0 && (
            <div className="space-y-2">
              <Label>Masques ({masks.length})</Label>
              <ul className="space-y-2">
                {masks.map((m, idx) => (
                  <li key={m.id} className="flex items-center gap-2 rounded-md border bg-card p-2">
                    <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                      {idx + 1}
                    </span>
                    <Input
                      placeholder="Label (optionnel) — ex. mitochondrie"
                      value={m.label ?? ""}
                      onChange={(e) => updateLabel(idx, e.target.value)}
                      className="h-8"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={() => removeMask(idx)}
                      aria-label={`Supprimer le masque ${idx + 1}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex items-center gap-2">
            <Button
              type="button"
              onClick={handleSave}
              disabled={createNote.isPending || masks.length === 0}
            >
              {createNote.isPending
                ? "Création..."
                : `Créer ${masks.length} carte${masks.length > 1 ? "s" : ""}`}
            </Button>
            {masks.length === 0 && (
              <span className="text-xs text-muted-foreground">
                Dessine au moins un masque pour activer le bouton.
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
