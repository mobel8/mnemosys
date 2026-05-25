# Mnemosys

Next-gen spaced repetition (SRS) desktop application — a fast, beautiful alternative to Anki, powered by the [FSRS](https://github.com/open-spaced-repetition/fsrs4anki) algorithm.

## Stack

- **Tauri 2** — native desktop shell (Rust backend)
- **React 19** + **TypeScript** — frontend
- **TanStack Router** + **TanStack Query** — routing & data
- **Zustand** — UI state
- **Tailwind CSS 4** + **shadcn/ui** + **Radix** — styling & primitives
- **SQLite** (via rusqlite + `tauri-plugin-sql`) — local storage
- **fsrs-rs** — scheduling algorithm
- **Biome 2** — lint + format
- **Vitest** + **Playwright** — testing

## Requirements

- Node 20+ and **pnpm** 9+
- Rust 1.81+ (via [`rustup`](https://rustup.rs))
- Linux: `webkit2gtk-4.1`, `libjavascriptcoregtk-4.1-dev`, `build-essential`, `libssl-dev`
- macOS: Xcode Command Line Tools
- Windows: Microsoft C++ Build Tools + WebView2

## Getting started

```bash
pnpm install
pnpm tauri:dev      # launch the desktop app in dev mode
```

Other useful scripts:

```bash
pnpm dev            # frontend only (Vite, port 1420)
pnpm typecheck      # tsc --noEmit
pnpm lint           # biome check
pnpm lint:fix       # biome check --write
pnpm test           # vitest (unit)
pnpm test:e2e       # playwright
pnpm tauri:build    # bundle a release binary
```

## Project layout

```
.
├── src/                # React frontend
│   ├── components/ui/  # shadcn primitives
│   ├── lib/            # cn(), utils, IPC clients
│   ├── routes/         # TanStack Router (stubs for now)
│   ├── stores/         # Zustand stores
│   └── styles/         # Tailwind 4 global CSS (tokens, theme)
├── src-tauri/          # Rust backend (Tauri 2)
│   ├── src/
│   │   ├── commands/   # #[tauri::command] handlers (B-wave)
│   │   ├── db/         # SQLite layer (A2)
│   │   ├── fsrs/       # FSRS scheduler wrapper (A3)
│   │   ├── error.rs    # AppError / AppResult
│   │   ├── lib.rs      # plugin registration + invoke_handler
│   │   └── main.rs
│   ├── capabilities/   # Tauri 2 permission manifests
│   └── tauri.conf.json
├── tests/
│   ├── unit/           # Vitest specs
│   └── e2e/            # Playwright specs
├── biome.json
├── playwright.config.ts
├── tsconfig.json
├── vite.config.ts
└── vitest.config.ts
```

## License

TBD.
