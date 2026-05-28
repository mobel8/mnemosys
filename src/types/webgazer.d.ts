/**
 * Minimal ambient typings for the `webgazer` package (Vague 12 — Focus
 * Guard). The published library ships no `.d.ts` and no `@types/webgazer`
 * exists, so we declare just the slice of its fluent API that
 * `FocusGuard.tsx` consumes. Methods are chainable (return the instance).
 *
 * See the upstream source (Brown University WebGazer) for the full surface;
 * extend this declaration if more methods are needed later.
 */
declare module "webgazer" {
  /** A single gaze sample in screen coordinates, or `null` when tracking is lost. */
  interface GazeData {
    x: number;
    y: number;
  }

  interface WebGazer {
    setGazeListener(listener: (data: GazeData | null, elapsedTime: number) => void): WebGazer;
    clearGazeListener(): WebGazer;
    showVideo(show: boolean): WebGazer;
    showFaceOverlay(show: boolean): WebGazer;
    showFaceFeedbackBox(show: boolean): WebGazer;
    showPredictionPoints(show: boolean): WebGazer;
    /** Start tracking. `onFail` fires if the webcam/init step fails. */
    begin(onFail?: () => void): Promise<WebGazer> | WebGazer;
    /** Stop tracking, release the camera and remove injected DOM nodes. */
    end(): WebGazer;
    pause(): WebGazer;
    resume(): WebGazer;
  }

  const webgazer: WebGazer;
  export default webgazer;
}
