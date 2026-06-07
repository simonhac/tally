import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

// Project Pages live under https://<owner>.github.io/<repo>/, so the built
// assets must be served from a sub-path. Default to "/tally/" (this repo's
// name); override with PAGES_BASE for a custom domain or different repo. Dev
// keeps "/" so the local URL stays clean.
const base = process.env.PAGES_BASE ?? "/tally/";

export default defineConfig(({ command }) => ({
  base: command === "build" ? base : "/",
  resolve: {
    alias: {
      // Consume the engine as source — same pattern the host app uses.
      "@tally": fileURLToPath(new URL("../src/index.ts", import.meta.url)),
    },
  },
  server: {
    // Allow importing the engine (../src) and dataset (../examples) that live
    // above the site root.
    fs: { allow: [fileURLToPath(new URL("..", import.meta.url))] },
  },
}));
