import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite config tuned for Tauri desktop dev:
// - fixed port 1420 (Tauri reads this from tauri.conf.json devUrl)
// - no clearScreen so Rust/Cargo logs stay visible alongside Vite logs
// - HMR over the same fixed port
//
// Reference: https://tauri.app/start/frontend/vite/
export default defineConfig(async () => ({
  plugins: [react()],
  clearScreen: false,
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
  build: {
    target: ["es2022", "chrome120", "safari16"],
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_DEBUG,
  },
}));
