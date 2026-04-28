/// <reference types="vitest" />
import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite config tuned for Tauri desktop dev:
// - fixed port 1420 (Tauri reads this from tauri.conf.json devUrl)
// - no clearScreen so Rust/Cargo logs stay visible alongside Vite logs
// - HMR over the same fixed port
//
// FSD aliases (mirror tsconfig.json paths):
//   @/*         → src/*
//   @app/*      → src/app/*
//   @shared/*   → src/shared/*
//   @entities/* → src/entities/*
//   @widgets/*  → src/widgets/*
//   @bindings/* → bindings/*  (ts-rs auto-generated Rust→TS types)
//
// Vitest config is colocated below the Vite config (same module).
//
// Reference: https://tauri.app/start/frontend/vite/
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@app": fileURLToPath(new URL("./src/app", import.meta.url)),
      "@shared": fileURLToPath(new URL("./src/shared", import.meta.url)),
      "@entities": fileURLToPath(new URL("./src/entities", import.meta.url)),
      "@widgets": fileURLToPath(new URL("./src/widgets", import.meta.url)),
      "@bindings": fileURLToPath(new URL("./bindings", import.meta.url)),
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    host: false,
    hmr: {
      protocol: "ws",
      host: "localhost",
      port: 1421,
    },
    watch: {
      // Don't watch src-tauri — Cargo handles that side.
      ignored: ["**/src-tauri/**"],
    },
  },
  // Tauri uses Chromium on Windows / WebKit on macOS — both modern.
  // Vite 8 ships oxc (rolldown) as the default minifier; esbuild was
  // unbundled in 8.x and would require a separate install.
  build: {
    target: ["es2022", "chrome120", "safari16"],
    minify: !process.env.TAURI_DEBUG ? "oxc" : false,
    sourcemap: !!process.env.TAURI_DEBUG,
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/app/test-setup.ts"],
    css: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/**/*.d.ts",
        "src/app/index.tsx",
        "src/app/test-setup.ts",
      ],
      // NFR §5 target is 75% branch coverage. Threshold-enforcement is
      // deferred to E2 — at E1 we only have 3 primitives and forcing
      // 75% across the FSD scaffold is misleading. Run `pnpm test:cov`
      // to see the report.
    },
  },
});
