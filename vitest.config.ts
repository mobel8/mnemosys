import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Vitest 2 ships its own copy of Vite 5 whose Plugin type differs from the
// Vite 7 installed at the workspace root. The plugin works at runtime; we
// just need to silence the structural mismatch at compile time.
export default defineConfig({
  // biome-ignore lint/suspicious/noExplicitAny: type collision between two vite versions
  plugins: [react() as any],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/unit/**/*.{test,spec}.{ts,tsx}", "src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules", "dist", "src-tauri", "tests/e2e/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      exclude: ["node_modules/", "tests/", "**/*.config.*", "src-tauri/**"],
    },
  },
});
