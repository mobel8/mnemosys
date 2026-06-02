/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Injected by vite.config.ts at build time — current package.json version. */
  readonly PACKAGE_VERSION: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// @fontsource-variable/* ship CSS-only side-effect entry points with no
// bundled type declarations; declare them so the imports in main.tsx typecheck.
declare module "@fontsource-variable/*";
