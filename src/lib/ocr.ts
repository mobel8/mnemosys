/**
 * Offline OCR via tesseract.js (WASM). All engine assets (worker, core wasm,
 * English traineddata) are bundled under `public/tesseract/` so recognition
 * runs fully offline inside the Tauri webview — no CDN, no network.
 *
 * Used by the « Capture → cartes » page to turn a screenshot / photo of notes
 * into flashcards.
 */

import { createWorker, type Worker } from "tesseract.js";

export interface OcrWord {
  text: string;
  confidence: number;
  /** Bounding box in source-image pixels. */
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

export interface OcrResult {
  /** Full recognised text, newlines preserved. */
  text: string;
  /** Non-empty trimmed lines. */
  lines: string[];
  /** Word-level boxes (for occlusion-mask suggestions). */
  words: OcrWord[];
}

// Minimal shape of the (optionally-returned) block tree, typed locally so we
// don't reach for `any` when flattening words.
interface TessWord {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}
interface TessLine {
  words?: TessWord[];
}
interface TessParagraph {
  lines?: TessLine[];
}
interface TessBlock {
  paragraphs?: TessParagraph[];
}

let workerPromise: Promise<Worker> | null = null;
let progressCb: ((p: number) => void) | null = null;

async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker("eng", 1, {
      workerPath: "/tesseract/worker.min.js",
      corePath: "/tesseract",
      langPath: "/tesseract",
      logger: (m: { status: string; progress: number }) => {
        if (m.status === "recognizing text") progressCb?.(m.progress);
      },
    });
  }
  return workerPromise;
}

/**
 * Recognise text in an image (data URL, Blob, File or HTMLImageElement source).
 * `onProgress` receives a 0..1 fraction during the recognition pass.
 */
export async function runOcr(
  image: string | File | Blob,
  onProgress?: (fraction: number) => void,
): Promise<OcrResult> {
  progressCb = onProgress ?? null;
  try {
    const worker = await getWorker();
    const { data } = await worker.recognize(image, {}, { blocks: true });

    const words: OcrWord[] = [];
    const blocks = (data as { blocks?: TessBlock[] }).blocks ?? [];
    for (const block of blocks) {
      for (const paragraph of block.paragraphs ?? []) {
        for (const line of paragraph.lines ?? []) {
          for (const w of line.words ?? []) {
            if (w.text.trim()) {
              words.push({ text: w.text, confidence: w.confidence, bbox: w.bbox });
            }
          }
        }
      }
    }

    const lines = data.text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    return { text: data.text, lines, words };
  } finally {
    progressCb = null;
  }
}

/** Free the worker (and its WASM memory) when the capture page unmounts. */
export async function terminateOcr(): Promise<void> {
  if (workerPromise) {
    const worker = await workerPromise;
    await worker.terminate();
    workerPromise = null;
  }
}
