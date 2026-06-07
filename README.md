# tally

A framework-agnostic election-simulation engine for Australian elections. It
takes a baseline election (per-seat primary votes + preference flows) and a
*scenario* (swings, preference overrides, demographic pins) and projects seats:

- **IRV** (instant-runoff / preferential voting) for single-member lower houses,
  with optional-preferential exhaustion.
- **STV** (Weighted Inclusive Gregory, with Group Voting Tickets + below-the-line
  split) for multi-member upper houses, plus a simpler Droop allocator.
- **Swing application** with a manual/automatic absorber model that conserves
  vote totals.
- **Demographic raking** (iterative proportional fitting) to reshape one party's
  geographic concentration while holding every other party's statewide total.
- **Monte Carlo** over the whole pipeline, with per-party noise drawn from the
  multinomial sampling covariance (proper σ *and* the negative correlations
  between shares), runnable in a Web Worker pool.

No React, no Next.js, no Node-only APIs. Pure TypeScript with zero runtime
dependencies — it runs in the browser (including Web Workers), Node, Deno or Bun.

> Status: Intended to graduate to its own published package.

## Demo site

A static, interactive demo lives in [`site/`](./site) and deploys to GitHub
Pages at **https://simonhac.github.io/tally/**. It runs this engine live in
the browser over the bundled 2022 Victorian dataset — swing the primaries and
watch the seats re-count, with an optional Monte Carlo uncertainty band.

Two executable helpers (tsx shebangs — runnable directly from the repo root):

```bash
cd site && npm install        # first time only

./site/start-web.ts           # serve the site locally (Vite dev server) → http://localhost:5173
./site/smoke-test.ts          # headless: print the baseline, a scenario, and the Monte Carlo summary
```

Equivalent npm scripts (`npm run web` / `npm run smoke`) and full build/deploy
instructions are in [`site/README.md`](./site/README.md).

## Install / consume

Today it's consumed as source via a tsconfig path alias:

```jsonc
// tsconfig.json
"paths": {
  "@tally": ["./tally/src/index.ts"],
  "@tally/*": ["./tally/src/*"]
}
```

```ts
import { runAllLaIrv, tallySeats, type Vic2022Data } from "@tally";
```

The Monte Carlo worker is loaded by URL, not imported as a value:

```ts
new Worker(new URL("@tally/mc/montecarlo.worker.ts", import.meta.url), { type: "module" });
```

## Quick start

```ts
import {
  emptyScenario, runAllLaIrv, tallySeats, runAllLcStv, tallyLcSeats,
  type Vic2022Data, type PartyId,
} from "@tally";

const baseline: Vic2022Data = /* your election data — see "Data shape" below */;

// The engine counts seats under each winner's RAW party id. Supply your own
// bucketing as an optional fold (omit it for raw counts).
const fold = (id: PartyId) => (id === "coa" ? "lib" : id.startsWith("ind_") ? "ind" : id);

const scenario = { ...emptyScenario(), manualSwings: { onp: 10, alp: -6 } };

const lower = tallySeats(runAllLaIrv(baseline.la.seats, baseline.preferenceFlows, scenario), fold);
const upper = tallyLcSeats(runAllLcStv(baseline.lc.regions, scenario), fold);
// → { alp: 51, lib: 27, nat: 6, grn: 4 }, ...
```

## Example / harness

[`examples/basic.ts`](./examples/basic.ts) is a self-contained worked example
**and** smoke harness. It runs the full pipeline — deterministic IRV + STV, a
scenario, and a 3,000-draw Monte Carlo — on the real 2022 Victorian state
election (bundled as [`examples/vic-2022.json`](./examples/vic-2022.json), so it
never reaches into a host app). Every section asserts an invariant and the
process exits non-zero on failure.

```bash
npx tsx tally/examples/basic.ts   # from the repo root
npm run example                   # from tally/
```

Sample output:

```
[1] 2022 baseline — deterministic seat projection
  Legislative Assembly (88): alp 56  lib 19  nat 9  grn 4
  Legislative Council (40): alp 15  lib 14  grn 4  dlp 2  lcn 2  oth 1  ajp 1  onp 1
[3] Monte Carlo — 3,000 draws, multinomial sampling covariance
  Labor Assembly seats: p05=54  p50=56  p95=61  mean=56.7
  P(Labor majority): 100.0%
✓ all checks passed
```

## Public API

Everything is re-exported from the barrel ([`src/index.ts`](./src/index.ts)):

| Area | Exports |
| --- | --- |
| Electoral math | `runLaIrv`, `runAllLaIrv`, `tallySeats`, `runLcStv`, `runAllLcStv`, `tallyLcSeats`, `rakeLaOnpDemographic`, `aggregateLaPrimaries`, `aggregateLcPrimaries`, `bucketParty`, `allocateProportionalRegion`, `reshapeLcRegionsFromLa`, … |
| Scenario | `emptyScenario`, `scenarioReducer`, `applySwing`, `applySwingForSeat`, `computeDemoStats`, `resolveOnpDemographic`, `mergeFlowOverrides`, `DEMOGRAPHICS`, `ONP_DEMO_MIN/MAX` |
| URL state | `seatsStateToQuery`, `seatsStateFromQuery`, `resolveActorParam` |
| Display | `resolveParty`, `BUCKET_LABEL` |
| Monte Carlo | `mulberry32`, `gaussian`, `buildMultinomialCholesky`, `computeQuantiles`, and the worker message types (`NoiseConfig`, `FoldSpec`, `Bench*Message`) |
| Types | `Vic2022Data`, `SeatBaseline`, `RegionBaseline`, `PreferenceFlows`, `ScenarioState`, `IrvResult`, `StvResult`, `PartyId`, `Demographic`, … |

## Design notes

- **Data-agnostic.** You pass a parsed `Vic2022Data`-shaped object; the engine
  never reads files. (The name is historical — the shape is generic: any
  jurisdiction's per-seat primaries + preference flows fit it.)
- **Party folding is the consumer's job.** `tallySeats` / `tallyLcSeats` default
  to identity (raw winner ids). Pass a `fold` to bucket — e.g. fold a joint
  Coalition ticket into one party, or collapse per-seat independents. This keeps
  jurisdiction policy out of the engine.
- **The Monte Carlo worker is electoral-only.** It returns per-sample seat
  tallies and per-sample vote aggregates; it knows nothing about funding or any
  other downstream model. Apply those to its output afterward. For the worker the
  fold crosses a thread boundary, so it's passed as a serializable `FoldSpec`
  rather than a function.
- **Determinism.** Same seed → same Monte Carlo stream. `mulberry32` + Box-Muller
  `gaussian` are exposed so callers can reproduce or extend a run.

## Building & publishing

The host app consumes `src/` directly (no build needed). To produce a
distributable package:

```bash
npm run build      # tsc → dist/ (compiled JS + .d.ts), driven by tsconfig.build.json
```

`package.json` `main`/`types`/`exports` point at `dist/`, and `files` ships
`dist` + this README. Publishing is gated off for now (`"private": true`); when
you're ready, set `"private": false`, pick a version, and `npm publish`
(`prepublishOnly` rebuilds `dist/` first).

## Data shape

```ts
interface Vic2022Data {
  parties: Record<PartyId, Party>;            // labels + colours
  preferenceFlows: { matrix: Record<PartyId, FlowRow> };   // source → destinations (~sum 1)
  la: { seats: SeatBaseline[] };              // single-member seats (primaries, twoCp, demographic)
  lc: { regions: RegionBaseline[] };          // multi-member regions (groups, GVT tickets, ATL/BTL)
  // …meta, assumptions
}
```

See [`src/types.ts`](./src/types.ts) for the full definitions and
[`examples/vic-2022.json`](./examples/vic-2022.json) for a complete instance.
