/**
 * HTML5 canvas drawing surface for the drawing effect (Wammes et al. 2016).
 *
 * Pointer Events so the same handlers cover mouse, touch and Apple Pencil.
 * The user draws their answer before flipping the card; the captured PNG
 * gets attached to the next `submit_review` via `useSaveSketch`.
 */

import { Eraser, Pencil, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface SketchCanvasProps {
  width?: number;
  height?: number;
  placeholder?: string;
  /** Called with the PNG data-URL when the user submits via `getDataUrl()`. */
  onExport?: (dataUrl: string | null) => void;
  className?: string;
}

type Tool = "pencil" | "eraser";

export interface SketchCanvasHandle {
  /** Returns the PNG data-URL or `null` if the canvas is empty. */
  getDataUrl: () => string | null;
  clear: () => void;
}

export function SketchCanvas({
  width = 800,
  height = 320,
  placeholder = "Dessine ta réponse ici avant de retourner la carte",
  onExport,
  className,
}: SketchCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [tool, setTool] = useState<Tool>("pencil");
  const [drawing, setDrawing] = useState(false);
  const [hasInk, setHasInk] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // Fill with white background so PNG export isn't transparent.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, []);

  function pointerPos(e: React.PointerEvent<HTMLCanvasElement>): [number, number] {
    const canvas = canvasRef.current;
    if (!canvas) return [0, 0];
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return [(e.clientX - rect.left) * scaleX, (e.clientY - rect.top) * scaleY];
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.preventDefault();
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    setDrawing(true);
    setHasInk(true);
    const [x, y] = pointerPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.strokeStyle = tool === "pencil" ? "#0f172a" : "#ffffff";
    ctx.lineWidth = tool === "pencil" ? Math.max(2, (e.pressure || 0.5) * 4) : 18;
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const [x, y] = pointerPos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function endStroke() {
    setDrawing(false);
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
    onExport?.(null);
  }

  function exportNow() {
    const canvas = canvasRef.current;
    if (!canvas || !hasInk) {
      onExport?.(null);
      return;
    }
    const url = canvas.toDataURL("image/png");
    onExport?.(url);
  }

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant={tool === "pencil" ? "default" : "outline"}
          onClick={() => setTool("pencil")}
          aria-label="Crayon"
        >
          <Pencil className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant={tool === "eraser" ? "default" : "outline"}
          onClick={() => setTool("eraser")}
          aria-label="Gomme"
        >
          <Eraser className="h-4 w-4" />
        </Button>
        <div className="flex-1" />
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={clear}
          disabled={!hasInk}
          aria-label="Effacer tout"
        >
          <Trash2 className="h-4 w-4" />
          Effacer
        </Button>
      </div>
      <div className="relative rounded-md border bg-white">
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          className="block w-full touch-none rounded-md"
          style={{ aspectRatio: `${width} / ${height}` }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endStroke}
          onPointerLeave={endStroke}
          onPointerCancel={endStroke}
          // Export latest state on every stroke end so the parent always has
          // a fresh dataURL when it triggers flip.
          onPointerUpCapture={exportNow}
        />
        {!hasInk && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            {placeholder}
          </div>
        )}
      </div>
    </div>
  );
}
