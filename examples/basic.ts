// tally — worked example + smoke harness.
//
// Runs the full engine pipeline on the real 2022 Victorian state election
// (bundled as ./vic-2022.json, so this example is self-contained — it does not
// reach into the host app's data loader):
//
//   1. Deterministic baseline — IRV across the 88 Legislative Assembly seats and
//      Weighted-Inclusive-Gregory STV across the 8 Legislative Council regions,
//      reduced to a per-party seat tally.
//   2. A scenario — apply a One Nation surge and show the vote/seat shift.
//   3. Monte Carlo — perturb the major-party swings by the multinomial sampling
//      covariance (the same Technique A the worker uses), N draws, and summarise
//      the Assembly-seat distribution with quantiles and P(majority).
//
// It is also a harness: every section asserts an invariant via `check()` and the
// process exits non-zero if any fails. Run it with:
//
//   npx tsx tally/examples/basic.ts      # from the repo root
//   npm run example                      # from tally/
//
// NOTE on folding: the engine counts seats under each winner's RAW party id. A
// jurisdiction supplies its own bucketing — here `vicFold` folds the joint LNP
// ticket (coa) into Liberal and every per-seat independent (ind_*) into "ind".

import {
  aggregateLaPrimaries,
  buildMultinomialCholesky,
  computeDemoStats,
  computeQuantiles,
  emptyScenario,
  gaussian,
  mulberry32,
  rakeLaOnpDemographic,
  resolveOnpDemographic,
  runAllLaIrv,
  runAllLcStv,
  tallyLcSeats,
  tallySeats,
  type PartyId,
  type ScenarioState,
  type Vic2022Data,
} from "../src/index";
import vic2022 from "./vic-2022.json";

const baseline = vic2022 as unknown as Vic2022Data;

// --- harness plumbing -------------------------------------------------------
let failures = 0;
function check(label: string, ok: boolean) {
  console.log(`  ${ok ? "✓" : "✗"} ${label}`);
  if (!ok) failures++;
}
function pct(n: number, d: number) {
  return d > 0 ? `${((n / d) * 100).toFixed(1)}%` : "—";
}
function showTally(label: string, tally: Record<PartyId, number>) {
  const total = Object.values(tally).reduce((a, b) => a + b, 0);
  const parts = Object.entries(tally)
    .sort((a, b) => b[1] - a[1])
    .map(([p, n]) => `${p} ${n}`)
    .join("  ");
  console.log(`  ${label} (${total}): ${parts}`);
}

// Victorian party bucketing — supplied by the consumer, not the engine.
function vicFold(id: PartyId): PartyId {
  if (id === "coa") return "lib";
  if (id.startsWith("ind_")) return "ind";
  return id;
}

const LA_TOTAL = baseline.la.seats.length; // 88
const LA_MAJORITY = Math.floor(LA_TOTAL / 2) + 1; // 45
const LC_TOTAL = baseline.lc.regions.reduce((a, r) => a + r.seats, 0); // 40

// --- 1. deterministic baseline ---------------------------------------------
console.log("\n[1] 2022 baseline — deterministic seat projection");
{
  const scenario = emptyScenario();
  const laTally = tallySeats(
    runAllLaIrv(baseline.la.seats, baseline.preferenceFlows, scenario),
    vicFold,
  );
  const lcTally = tallyLcSeats(runAllLcStv(baseline.lc.regions, scenario), vicFold);
  showTally("Legislative Assembly", laTally);
  showTally("Legislative Council", lcTally);

  check(`Assembly fills all ${LA_TOTAL} seats`, sum(laTally) === LA_TOTAL);
  check(`Council fills all ${LC_TOTAL} seats`, sum(lcTally) === LC_TOTAL);
  check("Labor holds a majority in the 2022 baseline", (laTally.alp ?? 0) >= LA_MAJORITY);
}

// --- 2. a scenario ----------------------------------------------------------
console.log("\n[2] Scenario — One Nation +10, Labor -6 (statewide primary swing)");
{
  const scenario: ScenarioState = {
    manualSwings: { onp: 10, alp: -6 },
    flowOverrides: {},
    onpDemographic: {},
  };
  const baseShare = statewideOnpPct(baseline, emptyScenario());
  const newShare = statewideOnpPct(baseline, scenario);
  const laTally = tallySeats(
    runAllLaIrv(baseline.la.seats, baseline.preferenceFlows, scenario),
    vicFold,
  );
  console.log(`  One Nation statewide LA primary: ${baseShare.toFixed(1)}% → ${newShare.toFixed(1)}%`);
  showTally("Assembly under scenario", laTally);
  check("the +10 swing lifts One Nation's statewide primary", newShare > baseShare);
}

// --- 3. Monte Carlo ---------------------------------------------------------
console.log("\n[3] Monte Carlo — 3,000 draws, multinomial sampling covariance");
{
  const N = 3000;
  const POLL_N = 1000; // effective poll sample size → per-party σ
  const SEED = 0x1d8b7;
  const NOISE: PartyId[] = ["alp", "lib", "nat", "grn", "onp", "oth"];
  const base: ScenarioState = {
    manualSwings: { onp: 6 },
    flowOverrides: {},
    onpDemographic: {},
  };

  const demoStats = computeDemoStats(baseline.la.seats);
  const agg = aggregateLaPrimaries(baseline.la.seats, base, { bucketIndies: false });
  const total = sum(agg);
  const shares = NOISE.map((p) => (total > 0 ? (agg[p] ?? 0) / total : 0));
  const cholesky = buildMultinomialCholesky(shares, POLL_N);
  const kMinus1 = NOISE.length - 1;

  const rng = mulberry32(SEED);
  const z = new Array<number>(kMinus1);
  const eps = new Array<number>(NOISE.length);
  const alpSeats: number[] = [];
  const onpSeats: number[] = [];

  for (let s = 0; s < N; s++) {
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
    for (let i = 0; i < NOISE.length; i++) {
      swings[NOISE[i]] = (base.manualSwings[NOISE[i]] ?? 0) + eps[i] * 100; // fraction → pp
    }
    const scenario: ScenarioState = { ...base, manualSwings: swings };

    // Mirror the deterministic path: resolve One Nation's demographic shape and
    // rake the per-seat primaries so every other party's statewide total holds.
    const onpPct = statewideOnpPct(baseline, scenario);
    const resolved = resolveOnpDemographic(onpPct, scenario.onpDemographic, demoStats);
    const rake = rakeLaOnpDemographic(baseline.la.seats, scenario, resolved);
    const raked = rake.feasible ? rake.primaries : undefined;

    const tally = tallySeats(
      runAllLaIrv(baseline.la.seats, baseline.preferenceFlows, scenario, resolved, raked),
      vicFold,
    );
    alpSeats.push(tally.alp ?? 0);
    onpSeats.push(tally.onp ?? 0);
  }

  const alpQ = computeQuantiles(alpSeats)!;
  const onpQ = computeQuantiles(onpSeats)!;
  const pAlpMajority = alpSeats.filter((n) => n >= LA_MAJORITY).length / N;

  console.log(`  Labor Assembly seats:      p05=${alpQ.p05}  p50=${alpQ.p50}  p95=${alpQ.p95}  mean=${alpQ.mean.toFixed(1)}`);
  console.log(`  One Nation Assembly seats: p05=${onpQ.p05}  p50=${onpQ.p50}  p95=${onpQ.p95}  mean=${onpQ.mean.toFixed(1)}`);
  console.log(`  P(Labor majority): ${pct(alpSeats.filter((n) => n >= LA_MAJORITY).length, N)}`);

  check("collected one Assembly tally per draw", alpSeats.length === N);
  check("Labor quantiles are ordered (p05 ≤ p50 ≤ p95)", alpQ.p05 <= alpQ.p50 && alpQ.p50 <= alpQ.p95);
  check("P(majority) is a probability in [0, 1]", pAlpMajority >= 0 && pAlpMajority <= 1);
}

// --- result -----------------------------------------------------------------
console.log(`\n${failures === 0 ? "✓ all checks passed" : `✗ ${failures} check(s) failed`}\n`);
process.exit(failures === 0 ? 0 : 1);

// --- helpers ----------------------------------------------------------------
function sum(rec: Record<string, number>): number {
  return Object.values(rec).reduce((a, b) => a + b, 0);
}
function statewideOnpPct(data: Vic2022Data, scenario: ScenarioState): number {
  const agg = aggregateLaPrimaries(data.la.seats, scenario, { bucketIndies: false });
  const total = sum(agg);
  return total > 0 ? ((agg.onp ?? 0) / total) * 100 : 0;
}
