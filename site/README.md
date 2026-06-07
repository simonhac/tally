# tally — demo site

A static, single-page demo that showcases the bundled 2022 Victorian election
dataset (`../examples/vic-2022.json`) and runs the real
[tally](../README.md) engine live in the browser:

- baseline composition of both chambers (88 + 40 seats),
- an **interactive scenario** — drag primary swings and watch IRV + STV
  re-count in real time,
- an opt-in **Uncertainty** toggle that streams a Monte Carlo run (in a Web
  Worker) and animates per-party seat whiskers + P(Labor majority),
- the full 88-seat Assembly table, the 8 Council regions, the preference-flow
  matrix, and the documented modelling assumptions.

Vanilla TypeScript + [Vite](https://vitejs.dev/) — no UI framework. The engine
is imported as source via the `@tally` alias; the dataset is imported directly
from `../examples`.

## Run it in a browser

```bash
cd site
npm install
npm run dev          # local dev server (http://localhost:5173)
```

`start-web.ts` does the same thing and is runnable from anywhere:

```bash
./site/start-web.ts        # from the repo root (executable, via the tsx shebang)
npx tsx site/start-web.ts  # from the repo root
npm run web                # from site/
```

## Verify without a browser

```bash
./site/smoke-test.ts        # from the repo root (executable, via the tsx shebang)
npx tsx site/smoke-test.ts  # from the repo root
npm run smoke               # from site/
```

It prints the baseline projection, a worked scenario, and the Monte Carlo
summary (per-party seat whiskers + P(Labor majority)) — the same maths the
browser runs, so you can sanity-check the numbers headlessly.

## Build & preview the production bundle

```bash
npm run build      # tsc --noEmit && vite build  →  site/dist
npm run preview    # serve the built bundle
```

By default the production build is served from `/tally/` (GitHub Pages project
path for `simonhac/tally`). Override for a different repo or a custom domain:

```bash
PAGES_BASE=/my-repo/ npm run build
PAGES_BASE=/ npm run build          # custom/apex domain
```

## Deploy

Pushed automatically to GitHub Pages by
[`.github/workflows/deploy-pages.yml`](../.github/workflows/deploy-pages.yml) on
every push to `main` that touches `site/`, `src/`, or the dataset. One-time
setup: in the repo, **Settings → Pages → Source → "GitHub Actions"**. The site
then lives at `https://simonhac.github.io/tally/`.
