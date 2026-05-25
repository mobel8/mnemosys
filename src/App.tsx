/**
 * Mnemosys — root component (scaffold).
 *
 * This is a deliberately minimal placeholder rendered until the Frontend
 * Architect (agent B1) wires the real TanStack Router + layout shell.
 * The router stubs live under `src/routes/` and are NOT yet mounted to keep
 * the foundation easy to compile.
 */
export default function App() {
  return (
    <main className="flex h-full w-full items-center justify-center bg-background text-foreground">
      <div className="flex flex-col items-center gap-3">
        <h1 className="text-4xl font-semibold tracking-tight">Mnemosys</h1>
        <p className="text-sm text-muted-foreground">
          Foundation scaffold ready — waiting for B1 to mount the router.
        </p>
      </div>
    </main>
  );
}
