/**
 * Interleaved review page — thin wrapper around `<InterleavedSession />`.
 *
 * Follows the same convention as `ai-generate.page.tsx`: the route stays
 * a layout-only shell, the actual orchestration (deck picker + session
 * handoff) lives in the component.
 */

import { InterleavedSession } from "@/components/InterleavedSession";

export default function ReviewInterleavedRoute() {
  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Review entrelacée</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Mélange plusieurs decks dans une seule session pour forcer la discrimination
          inter-contextes. Rohrer &amp; Taylor (2015) — environ ×2 sur le test différé par rapport à
          la pratique en bloc.
        </p>
      </header>

      <InterleavedSession />
    </div>
  );
}
