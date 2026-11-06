import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  build: { outDir: "dist-agile", emptyOutDir: true, chunkSizeWarningLimit: 900 },
  server: { proxy: process.env.VIBE_GIT_PANEL_URL ? {
    "/api": { target: process.env.VIBE_GIT_PANEL_URL, changeOrigin: true, headers: { origin: process.env.VIBE_GIT_PANEL_URL } },
    "/_local": { target: process.env.VIBE_GIT_PANEL_URL, changeOrigin: true }
  } : { "/api/v1": { target: "http://127.0.0.1:8787", changeOrigin: true } } }
});
