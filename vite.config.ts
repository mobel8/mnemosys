import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type PluginOption } from "vite";

const host = process.env.TAURI_DEV_HOST;
const dirname = path.dirname(fileURLToPath(import.meta.url));
// Read version from package.json at build time so the About page can
// surface it without a runtime fetch. Falls back to a sentinel so the
// page always renders something useful.
const pkgVersion = (() => {
  try {
    const pkg = JSON.parse(readFileSync(path.join(dirname, "package.json"), "utf8")) as {
      version?: string;
    };
    return pkg.version ?? "0.0.0-dev";
  } catch {
    return "0.0.0-dev";
  }
})();

// https://vite.dev/config/
export default defineConfig({
  // Vite 7 + @tailwindcss/vite 4 + @vitejs/plugin-react 5 have a Plugin type
  // mismatch (FalsyPlugin vs false). Cast through unknown to keep both.
  plugins: [react(), tailwindcss()] as unknown as PluginOption[],

  define: {
    "import.meta.env.PACKAGE_VERSION": JSON.stringify(pkgVersion),
  },

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },

  // Env prefixes accepted by the front-end (in addition to VITE_)
  envPrefix: ["VITE_", "TAURI_ENV_*"],

  build: {
    // Tauri uses Chromium on Windows and WebKit on macOS and Linux
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    // don't minify for debug builds
    minify: !process.env.TAURI_ENV_DEBUG ? "esbuild" : false,
    // produce sourcemaps for debug builds
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    rollupOptions: {
      output: {
        // Split heavy, rarely-changing vendors into their own long-term
        // cacheable chunks so the eager entry stays small. Route-level lazy
        // libraries (three via PalaceScene, recharts via stats, webgazer via
        // FocusGuard) are already emitted as dynamic chunks by their
        // `import()` sites — we deliberately do NOT name them here so Rollup
        // keeps them out of the eager graph.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          // React core — pinned first so react/react-dom never leak into a
          // sibling vendor chunk (which would force-load them eagerly).
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) {
            return "react-vendor";
          }
          if (/[\\/]node_modules[\\/]@tanstack[\\/]/.test(id)) {
            return "tanstack";
          }
          if (/[\\/]node_modules[\\/]@radix-ui[\\/]/.test(id)) {
            return "radix";
          }
          // framer-motion ships as `framer-motion` + `motion-dom` + `motion-utils`.
          if (/[\\/]node_modules[\\/](framer-motion|motion-dom|motion-utils)[\\/]/.test(id)) {
            return "motion";
          }
          return undefined;
        },
      },
    },
  },
});
