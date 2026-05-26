/**
 * Render an image-occlusion card during a review.
 *
 * - **Question side**: shows the source image with every mask drawn opaque.
 *   The mask matching the card's `card_ord` is rendered in destructive red
 *   to focus the learner on "what's behind THIS one"; the other masks stay
 *   neutral so context can give clues.
 * - **Answer side**: removes all masks (image fully visible) and prints the
 *   target mask's label (or a fallback "Masque #N") in a large block.
 *
 * Coordinates from `note.fields` are in source-image pixel space. We use
 * absolute-positioned `<div>` overlays on top of an `<img>` and scale via
 * `naturalWidth/Height → display width/height`, so the layout survives any
 * container size.
 */

import { convertFileSrc } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Note, OcclusionFields, OcclusionMask } from "@/lib/tauri";
import { cn } from "@/lib/utils";

interface OcclusionReviewViewProps {
  note: Note;
  /** 0-based index of the mask that's being quizzed by the current card. */
  cardOrd: number;
  /** `true` once the user has flipped to the answer side. */
  showAnswer: boolean;
}

function parseFields(note: Note): OcclusionFields | null {
  const f = note.fields as Record<string, unknown>;
  const image_path = typeof f.image_path === "string" ? f.image_path : null;
  const natural_width = typeof f.natural_width === "number" ? f.natural_width : null;
  const natural_height = typeof f.natural_height === "number" ? f.natural_height : null;
  const rawMasks = Array.isArray(f.masks) ? (f.masks as unknown[]) : null;
  if (!image_path || !natural_width || !natural_height || !rawMasks) return null;
  const masks: OcclusionMask[] = rawMasks
    .map((m): OcclusionMask | null => {
      if (typeof m !== "object" || m === null) return null;
      const mm = m as Record<string, unknown>;
      if (
        typeof mm.x !== "number" ||
        typeof mm.y !== "number" ||
        typeof mm.width !== "number" ||
        typeof mm.height !== "number"
      ) {
        return null;
      }
      return {
        x: mm.x,
        y: mm.y,
        width: mm.width,
        height: mm.height,
        label: typeof mm.label === "string" ? mm.label : "",
      };
    })
    .filter((m): m is OcclusionMask => m !== null);
  return { image_path, natural_width, natural_height, masks };
}

export function OcclusionReviewView({ note, cardOrd, showAnswer }: OcclusionReviewViewProps) {
  const fields = parseFields(note);
  const imgRef = useRef<HTMLImageElement | null>(null);
  // Display size in CSS pixels — recomputed on load and on container resize so
  // the overlay rectangles always match the image.
  const [displaySize, setDisplaySize] = useState<{ w: number; h: number } | null>(null);

  const recompute = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    setDisplaySize({ w: img.clientWidth, h: img.clientHeight });
  }, []);

  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const img = imgRef.current;
    if (!img) return;
    const obs = new ResizeObserver(() => recompute());
    obs.observe(img);
    return () => obs.disconnect();
  }, [recompute]);

  if (!fields) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/10 p-6 text-center text-sm text-destructive">
        Carte d'image-occlusion invalide (champs manquants).
      </div>
    );
  }

  const target = fields.masks[cardOrd];
  const targetLabel = (target?.label ?? "").trim();
  const sx = displaySize ? displaySize.w / fields.natural_width : 0;
  const sy = displaySize ? displaySize.h / fields.natural_height : 0;

  return (
    <div className="space-y-4">
      <div className="relative inline-block max-w-full">
        <img
          ref={imgRef}
          src={convertFileSrc(fields.image_path)}
          alt="Image-occlusion"
          onLoad={recompute}
          className="block max-h-[60vh] w-auto max-w-full select-none"
          draggable={false}
        />
        {/* Mask overlays. Hidden entirely on the answer face so the learner
            can see the picture in full. */}
        {!showAnswer &&
          displaySize &&
          fields.masks.map((m, idx) => {
            const isTarget = idx === cardOrd;
            // The mask list is immutable within a single review (the note
            // shape doesn't change while the user is grading), so an
            // index-based key is stable and predictable here.
            const key = `mask-${m.x}-${m.y}-${m.width}-${m.height}`;
            return (
              <div
                key={key}
                role="img"
                aria-label={isTarget ? "Masque cible à deviner" : `Masque #${idx + 1}`}
                className={cn(
                  "pointer-events-none absolute flex items-center justify-center text-xs font-bold",
                  isTarget
                    ? "bg-destructive text-destructive-foreground"
                    : "bg-muted-foreground/85 text-background",
                )}
                style={{
                  left: m.x * sx,
                  top: m.y * sy,
                  width: m.width * sx,
                  height: m.height * sy,
                }}
              >
                {isTarget ? "?" : idx + 1}
              </div>
            );
          })}
      </div>

      {showAnswer && (
        <div className="rounded-md border bg-card p-4 text-center">
          <p className="text-xs uppercase text-muted-foreground">Réponse (masque #{cardOrd + 1})</p>
          <p className="mt-1 text-2xl font-semibold">
            {targetLabel.length > 0 ? targetLabel : <em>(pas de label)</em>}
          </p>
        </div>
      )}
    </div>
  );
}
