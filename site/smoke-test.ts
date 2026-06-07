#!/usr/bin/env -S npx tsx
// smoke-test.ts — headless smoke test for the demo's engine wiring.
//
// Reproduces, in the terminal, exactly what the site computes: the
// deterministic baseline projection, a worked scenario, and the Monte Carlo
// uncertainty summary (per-party seat whiskers + P(Labor majority)). The
// browser runs the Monte Carlo in a Web Worker; here we run the same maths
// inline so you can sanity-check the numbers without a browser.
//
//   ./site/smoke-test.ts                 # from the repo root (executable)
//   npx tsx site/smoke-test.ts           # from the repo root
//   npm run smoke                        # from site/  (uses tsx)
//
// To actually serve the site in a browser, use `./site/start-web.ts`
// (or `npm run dev` / `npm run web`).

import {
  aggregateLaPrimaries,
  buildMultinomialCholesky,
  computeQuantiles,
  emptyScenario,
  gaussian,
  mulberry32,
  runAllLaIrv,
  runAllLcStv,
  tallyLcSeats,
  tallySeats,
  type PartyId,
  type ScenarioState,
  type Vic2022Data,
} from "../src/index";
import raw from "../examples/vic-2022.json";

const DATA = raw as unknown as Vic2022Data;

const LA_TOTAL = DATA.la.seats.length;
const LC_TOTAL = DATA.lc.regions.reduce((a, r) => a + r.seats, 0);
const LA_MAJORITY = Math.floor(LA_TOTAL / 2) + 1;

// Same consumer fold the site uses, plus a display fold that combines the
// Coalition partners into one row.
function vicFold(id: PartyId): PartyId {
  if (id === "coa") return "lib";
  if (id.startsWith("ind_")) return "ind";
  return id;
}
function foldCoalition(t: Record<PartyId, number>): Record<PartyId, number> {
  const out: Record<PartyId, number> = {};
  for (const [k, v] of Object.entries(t)) {
    const d = k === "lib" || k === "nat" || k === "coa" ? "coa" : k;
    out[d] = (out[d] ?? 0) + v;
  }
  return out;
}
const sum = (t: Record<string, number>) =>
  Object.values(t).reduce((a, b) => a + b, 0);

function showTally(label: string, tally: Record<PartyId, number>) {
  const parts = Object.entries(tally)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([p, n]) => `${p} ${n}`)
    .join("  ");
  console.log(`  ${label} (${sum(tally)}): ${parts}`);
}

function projectLa(s: ScenarioState) {
  return tallySeats(runAllLaIrv(DATA.la.seats, DATA.preferenceFlows, s), vicFold);
}
function projectLc(s: ScenarioState) {
  return tallyLcSeats(runAllLcStv(DATA.lc.regions, s), vicFold);
}

// --- 1. baseline ------------------------------------------------------------
console.log("\n[1] Baseline — deterministic 2022 projection");
{
  const s = emptyScenario();
  showTally("Assembly", foldCoalition(projectLa(s)));
  showTally("Council ", foldCoalition(projectLc(s)));
}

// --- 2. a scenario ----------------------------------------------------------
console.log("\n[2] Scenario — One Nation +10, Labor −6");
{
  const s: ScenarioState = {
    manualSwings: { onp: 10, alp: -6 },
    flowOverrides: {},
    onpDemographic: {},
  };
  showTally("Assembly", foldCoalition(projectLa(s)));
}

// --- 3. Monte Carlo (inline mirror of the worker) ---------------------------
console.log("\n[3] Uncertainty — Monte Carlo, 5,000 draws");
{
  const N = 5000;
  const POLL_N = 1000;
  const SEED = 0x1d8b7;
  const NOISE: PartyId[] = ["alp", "lib", "nat", "grn", "onp", "oth"];
  const base = emptyScenario();

  const agg = aggregateLaPrimaries(DATA.la.seats, base, { bucketIndies: false });
  const total = sum(agg);
  const shares = NOISE.map((p) => (total > 0 ? (agg[p] ?? 0) / total : 0));
  const cholesky = buildMultinomialCholesky(shares, POLL_N);
  const kMinus1 = NOISE.length - 1;

  const rng = mulberry32(SEED);
  const z = new Array<number>(kMinus1);
  const eps = new Array<number>(NOISE.length);
  const series: Record<string, number[]> = {};

  for (let d = 0; d < N; d++) {
    for (let k = 0; k < kMinus1; k++) z[k] = gaussian(rng);
    let sumEps = 0;
    for (let i = 0; i < kMinus1; i++) {
      let v = 0;
      for (let j = 0; j <= i; j++) v += cholesky[i * kMinus1 + j] * z[j];
      eps[i] = v;
      sumEps += v;
    }
    eps[kMinus1] = -sumEps;
    const swings: Record<PartyId, number> = { ...base.manualSwings };
    for (let i = 0; i < NOISE.length; i++) swings[NOISE[i]] = eps[i] * 100;

    const tally = foldCoalition(
      projectLa({ ...base, manualSwings: swings }),
    );
    for (const id of ["alp", "coa", "grn", "onp", "ind", "oth"]) {
      (series[id] ??= []).push(tally[id] ?? 0);
    }
  }

  for (const id of ["alp", "coa", "grn"]) {
    const q = computeQuantiles(series[id])!;
    console.log(
      `  ${id.padEnd(4)} seats: p05=${q.p05}  p50=${q.p50}  p95=${q.p95}  mean=${q.mean.toFixed(1)}`,
    );
  }
  const pMaj = series.alp.filter((n) => n >= LA_MAJORITY).length / N;
  console.log(`  P(Labor majority): ${(pMaj * 100).toFixed(1)}%`);
}

console.log("");
