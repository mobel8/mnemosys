/**
 * Offline OCR via tesseract.js (WASM). All engine assets (worker, core wasm,
 * traineddata) are bundled under `public/tesseract/` so recognition runs fully
 * offline inside the Tauri webview — no CDN, no network.
 *
 * Language data: the OCR language is configurable (see `OcrLang` / `runOcr`).
 * `eng.traineddata.gz` ships by default; drop `fra.traineddata.gz` (and any
 * other `<lang>.traineddata.gz`) into `public/tesseract/` to enable that
 * language. A worker is cached per language so switching languages is cheap on
 * repeat use, and a failed language load surfaces as a thrown error the caller
 * can toast rather than a silent freeze.
 *
 * Used by the « Capture → cartes » page to turn a screenshot / photo of notes
 * into flashcards.
 */

import { createWorker, type Worker } from "tesseract.js";

/**
 * Recognised OCR languages. `fra` (French) is the sensible default for this
 * FR-first app once `fra.traineddata.gz` is bundled; `eng` always ships.
 * Tesseract language codes are ISO 639-2/T (three letters).
 */
export type OcrLang = "fra" | "eng";

/** Default OCR language for the app (French-first UI). */
export const DEFAULT_OCR_LANG: OcrLang = "fra";

/** Selectable OCR languages with their FR display labels. */
export const OCR_LANGUAGES: readonly { value: OcrLang; label: string }[] = [
  { value: "fra", label: "Français" },
  { value: "eng", label: "Anglais" },
] as const;

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
  /**
   * Language actually used for recognition. Usually equals the requested
   * `lang`, but falls back to `"eng"` when the requested traineddata could not
   * be loaded (e.g. `fra.traineddata.gz` not bundled), so the caller can warn.
   */
  lang: OcrLang;
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

/** One cached worker per language, keyed by `OcrLang`. */
const workerPromises = new Map<OcrLang, Promise<Worker>>();

/**
 * Progress callback scoped to the *currently running* OCR job. The worker
 * logger is registered once at creation and lives for the worker's whole
 * lifetime, so it must read the active callback indirectly (a module field)
 * rather than capturing one. We re-point this field for each job; a stale
 * callback from a previous job is never invoked because runs are serialised
 * (see `ocrChain`) and the field is reset in `recognizeOnce`'s `finally`.
 */
let progressCb: ((p: number) => void) | null = null;

/**
 * Serialises OCR runs. `runOcr` chains onto the previous run so a second call
 * waits for the first to finish before re-pointing `progressCb` — two
 * concurrent runs can no longer cross-drive each other's progress UI.
 */
let ocrChain: Promise<unknown> = Promise.resolve();

/**
 * Number of recognitions currently in flight. `terminateOcr` refuses to free
 * the workers while this is > 0 (terminating mid-recognition rejects the
 * pending promise and can wedge the worker), deferring teardown to the caller.
 */
let inFlight = 0;

async function getWorker(lang: OcrLang): Promise<Worker> {
  let promise = workerPromises.get(lang);
  if (!promise) {
    promise = createWorker(lang, 1, {
      workerPath: "/tesseract/worker.min.js",
      corePath: "/tesseract",
      langPath: "/tesseract",
      logger: (m: { status: string; progress: number }) => {
        if (m.status === "recognizing text") progressCb?.(m.progress);
      },
    }).catch((err) => {
      // Don't cache a failed init (e.g. missing `<lang>.traineddata.gz`); a
      // later retry — or a different language — must be able to start fresh.
      workerPromises.delete(lang);
      throw err;
    });
    workerPromises.set(lang, promise);
  }
  return promise;
}

/**
 * Recognise text in an image (data URL, Blob, File or HTMLImageElement source).
 *
 * @param lang OCR language code; defaults to {@link DEFAULT_OCR_LANG} (French).
 *   The matching `<lang>.traineddata.gz` must be bundled under
 *   `public/tesseract/`. When it is missing (e.g. French data not yet shipped),
 *   recognition transparently falls back to English so OCR never hard-fails;
 *   the effective language is reported back in `OcrResult.lang`.
 * @param onProgress receives a 0..1 fraction during the recognition pass.
 */
export async function runOcr(
  image: string | File | Blob,
  onProgress?: (fraction: number) => void,
  lang: OcrLang = DEFAULT_OCR_LANG,
): Promise<OcrResult> {
  // Serialise runs: chain onto the previous run so two concurrent callers
  // never share/overwrite `progressCb` while both are recognising. We swallow
  // the predecessor's outcome (`.catch`) — a failed prior run must not reject
  // this one before it even starts.
  const run = ocrChain
    .catch(() => undefined)
    .then(() => recognizeOnce(image, onProgress ?? null, lang));
  // Keep the chain alive regardless of this run's outcome.
  ocrChain = run.catch(() => undefined);
  return run;
}

/** Single serialised recognition pass — only one runs at a time. */
async function recognizeOnce(
  image: string | File | Blob,
  onProgress: ((fraction: number) => void) | null,
  lang: OcrLang,
): Promise<OcrResult> {
  progressCb = onProgress;
  inFlight += 1;
  try {
    let effectiveLang = lang;
    let worker: Worker;
    try {
      worker = await getWorker(lang);
    } catch (err) {
      // Requested language data unavailable. Fall back to English (which always
      // ships) rather than failing the whole OCR pass.
      if (lang === "eng") throw err;
      effectiveLang = "eng";
      worker = await getWorker("eng");
    }
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

    return { text: data.text, lines, words, lang: effectiveLang };
  } finally {
    inFlight -= 1;
    progressCb = null;
  }
}

/**
 * Free every cached worker (and its WASM memory) when the page unmounts.
 *
 * If a recognition is still in flight (e.g. the user navigated away mid-OCR),
 * terminating now would reject the pending `recognize` promise and can wedge
 * the worker. We defer teardown until the active run settles by chaining onto
 * `ocrChain`, so the in-flight recognition completes first and the worker is
 * freed cleanly afterwards.
 */
export async function terminateOcr(): Promise<void> {
  if (inFlight > 0) {
    // Defer: let the running recognition finish, then tear down.
    const deferred = ocrChain.catch(() => undefined).then(() => terminateOcr());
    ocrChain = deferred.catch(() => undefined);
    return deferred;
  }
  const pending = Array.from(workerPromises.values());
  workerPromises.clear();
  await Promise.all(
    pending.map(async (promise) => {
      try {
        const worker = await promise;
        await worker.terminate();
      } catch {
        // A worker that never finished initialising has nothing to free.
      }
    }),
  );
}
