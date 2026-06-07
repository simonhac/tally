#!/usr/bin/env -S npx tsx
// start-web.ts — boot the demo site's dev server so you can test it in a
// browser. Thin wrapper over Vite's programmatic API; equivalent to
// `npm run dev`, but runnable directly from anywhere:
//
//   ./site/start-web.ts                  # from the repo root (executable)
//   npx tsx site/start-web.ts            # from the repo root
//   npm run web                          # from site/
//
// To exercise the production build instead, use `npm run build && npm run preview`.

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

// Anchor Vite's root + config to this file's directory so the server works no
// matter what the current working directory is.
const root = dirname(fileURLToPath(import.meta.url));

const server = await createServer({
  root,
  configFile: `${root}/vite.config.ts`,
});

await server.listen();
server.printUrls();
server.bindCLIShortcuts({ print: true });
