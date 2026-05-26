/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Injected by vite.config.ts at build time — current package.json version. */
  readonly PACKAGE_VERSION: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
