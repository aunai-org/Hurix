import { defineConfig } from "vite";

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

// A static site: the satellite frame lives in public/data (written by pipeline/), the globe textures in public/textures.
export default defineConfig({
  // relative URLs, so the built site works from any folder (and as a claude.ai artifact)
  base: "./",
  server: { port: Number(env.PORT) || 5173 },
  // three.js is most of the bundle; it is one file on purpose so the globe starts in a single request
  build: { chunkSizeWarningLimit: 800 },
});
