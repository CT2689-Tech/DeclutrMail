import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// Minimal seed config. Concerns that v1's vite.config.ts handles (MDX
// content, prerender for SEO, Sentry source-map upload, lovable-tagger,
// per-route CSP injection) are intentionally NOT brought over yet — each
// feature that needs one of them ships it as part of that feature's PR,
// rather than maintaining speculative complexity here.

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const resolveHost = () => {
  const raw = process.env.VITE_DEV_HOST ?? process.env.DEV_HOST ?? process.env.HOST;
  if (!raw || raw === "false") return "localhost";
  if (raw === "true") return true;
  return raw;
};

const resolvePort = () => {
  const raw = process.env.VITE_DEV_PORT ?? process.env.DEV_PORT ?? process.env.PORT;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5173;
};

export default defineConfig({
  plugins: [react()],
  server: {
    host: resolveHost(),
    port: resolvePort(),
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
