import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  build: { outDir: "review-dist", emptyOutDir: true, rollupOptions: { input: "review.html" } }
});
