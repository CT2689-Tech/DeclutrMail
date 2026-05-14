import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// Minimal seed config. Per-feature concerns (MDX content, prerender for SEO,
// Sentry source-map upload, per-route CSP injection) are intentionally NOT
// brought over yet — each feature that needs one of them ships it as part
// of that feature's PR, rather than maintaining speculative complexity here.

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  server: {
    host: process.env.VITE_DEV_HOST || "localhost",
    port: Number(process.env.VITE_DEV_PORT) || 5173,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    minify: "esbuild",
  },
});
