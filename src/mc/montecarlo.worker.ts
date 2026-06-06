// Monte Carlo worker. Runs the election pipeline N times — optionally with
// per-sample noise — and returns per-sample LA seat, LC seat, and per-party
// vote-aggregate tallies for the driver to summarise. ELECTORAL-ONLY: it knows
// nothing about funding; the driver applies any jurisdiction's funding model to
// the vote/seat output afterward.
//
//   - app/admin/bench-mc — the diagnostic page (kept for re-tuning σ / noise).
//   - lib/seats/useMonteCarlo — the production hook driving the Uncertainty
//     section on the seats pages.
//
// Designed for pool reuse: the first message ships the baseline + scaling;
// subsequent messages may omit them (cached in module scope). Deadline-mode for
// time-budgeted runs; sample-count mode for the convergence harness.

import { aggregateLaPrimaries, aggregateLcPrimaries } from "../aggregate";
import { runAllLaIrv, tallySeats } from "../irv";
import { rakeLaOnpDemographic } from "../raking";
import { computeDemoStats, resolveOnpDemographic } from "../scenario";
import { runAllLcStv, tallyLcSeats } from "../stv";
import type { PartyId, ScenarioState, Vic2022Data } from "../types";
import { gaussian, mulberry32 } from "./prng";
import type {
  BenchDoneMessage,
  BenchInMessage,
  BenchInterimMessage,
  BenchProgressMessage,
  BenchRunMessage,
  FoldSpec,
} from "./messages";

// Build a fold function from a serializable spec. Absent spec = identity.
function makeFold(spec?: FoldSpec): (id: PartyId) => PartyId {
  if (!spec) return (id) => id;
  const exact = spec.exact ?? {};
  const prefix = spec.prefix ?? [];
  return (id) => {
    if (id in exact) return exact[id];
    for (const [p, t] of prefix) if (id.startsWith(p)) return t;
    return id;
  };
}

function hashTally(
  la: Record<PartyId, number>,
  lc: Record<PartyId, number>,
): string {
  const flat = [...Object.entries(la), ...Object.entries(lc)]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${v}`)
    .join("|");
  let h = 5381;
  for (let i = 0; i < flat.length; i++) {
    h = ((h << 5) + h + flat.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16);
}

// Worker-scoped cache so pool-reuse mode can ship the baseline once and then run
// many cheap "run" messages. Populated on the first message; re-populated when a
// message arrives with fresh baseline data.
let cachedBaseline: Vic2022Data | null = null;
let cachedScaling: number | null = null;
let cachedDemoStats: ReturnType<typeof computeDemoStats> | null = null;

// Mutable state for the currently-active run. `currentToken` distinguishes
// runs: a new `run` message bumps the token, and any older async run loop bails
// out (without posting `done`) when it notices its token no longer matches.
let currentToken = 0;
let activeDeadline: number | null = null;

// Time-based yield: the worker yields to the event loop once YIELD_INTERVAL_MS
// of wall-clock has elapsed since the last yield. Time-based (rather than
// sample-count-based) bounds cancellation latency by ~100ms regardless of
// browser/machine speed.
const YIELD_INTERVAL_MS = 100;

// How often (wall-clock) to send an interim snapshot of accumulated tallies.
const INTERIM_INTERVAL_MS = 500;

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

self.onmessage = (e: MessageEvent<BenchInMessage>) => {
  const msg = e.data;
  if (msg.type === "update-deadline") {
    // Only meaningful while a run is active. Setting deadline to a past value
    // stops the loop at its next yield (~one batch ≈ 150ms).
    if (activeDeadline !== null) activeDeadline = msg.deadlineEpochMs;
    return;
  }
  if (msg.type !== "run") return;

  if (msg.baseline !== undefined) {
    cachedBaseline = msg.baseline;
    cachedDemoStats = computeDemoStats(msg.baseline.la.seats);
  }
  if (msg.scaling !== undefined) cachedScaling = msg.scaling;

  const baseline = cachedBaseline;
  const scaling = cachedScaling;
  const demoStats = cachedDemoStats;
  if (!baseline || scaling === null || !demoStats) {
    throw new Error(
      "montecarlo worker: first message must include baseline and scaling",
    );
  }

  // Bump the token: any older async loop will bail on next iteration.
  const myToken = ++currentToken;
  activeDeadline = msg.deadlineEpochMs ?? null;
  void runJob(msg, myToken, baseline, scaling, demoStats);
};

async function runJob(
  msg: BenchRunMessage,
  token: number,
  baseline: Vic2022Data,
  scaling: number,
  demoStats: ReturnType<typeof computeDemoStats>,
): Promise<void> {
  const { scenario, nSamples, progressEvery, workerId, noise, collectTallies } =
    msg;

  const fold = makeFold(msg.fold);
  const rng = noise ? mulberry32(noise.seed) : null;
  const noiseParties = noise?.parties ?? [];
  const noiseSigma = noise?.sigmaPp ?? {};
  const noiseCholesky = noise?.cholesky ?? null;
  // For Technique A: dimension of the unconstrained subspace = k-1, and the
  // k-th party absorbs the residual.
  const kMinus1 = noiseParties.length > 0 ? noiseParties.length - 1 : 0;
  const epsBuf = new Array<number>(noiseParties.length);
  const zBuf = new Array<number>(kMinus1);

  const laTallies: Record<string, number[]> = {};
  const lcTallies: Record<string, number[]> = {};
  const lhVotes: Record<string, number[]> = {};
  const uhVotes: Record<string, number[]> = {};

  const t0 = performance.now();
  let lastHash = "";
  let completed = 0;
  let lastInterimMs = Date.now();
  let lastInterimSamples = 0;

  let batchStartMs = Date.now();
  outer: while (true) {
    while (true) {
      if (token !== currentToken) return; // preempted; don't post done
      if (activeDeadline !== null && Date.now() >= activeDeadline) break outer;
      if (completed >= nSamples) break outer;
      if (Date.now() - batchStartMs >= YIELD_INTERVAL_MS) break;

      // Build per-sample scenario. Two noise modes:
      //   - Technique A (cholesky present): sample standard normals z, compute
      //     ε = L·z, recover the k-th party as the negative sum. ε is in
      //     FRACTION units; scale to pp when applying.
      //   - Technique B (sigmaPp present): independent N(0, σ²) per party,
      //     project to zero-sum by subtracting the mean.
      let sampleScenario = scenario;
      if (rng && noiseParties.length > 0) {
        if (noiseCholesky !== null) {
          for (let k = 0; k < kMinus1; k++) zBuf[k] = gaussian(rng);
          let sumEps = 0;
          for (let i = 0; i < kMinus1; i++) {
            let v = 0;
            for (let j = 0; j <= i; j++) {
              v += noiseCholesky[i * kMinus1 + j] * zBuf[j];
            }
            epsBuf[i] = v;
            sumEps += v;
          }
          epsBuf[kMinus1] = -sumEps;
          const perturbedSwings: Record<PartyId, number> = {
            ...scenario.manualSwings,
          };
          for (let i = 0; i < noiseParties.length; i++) {
            const p = noiseParties[i];
            perturbedSwings[p] =
              (scenario.manualSwings[p] ?? 0) + epsBuf[i] * 100;
          }
          sampleScenario = { ...scenario, manualSwings: perturbedSwings };
        } else {
          let sumEps = 0;
          for (let k = 0; k < noiseParties.length; k++) {
            const sigma = noiseSigma[noiseParties[k]] ?? 0;
            const e = sigma > 0 ? gaussian(rng) * sigma : 0;
            epsBuf[k] = e;
            sumEps += e;
          }
          const meanEps = sumEps / noiseParties.length;
          const perturbedSwings: Record<PartyId, number> = {
            ...scenario.manualSwings,
          };
          for (let k = 0; k < noiseParties.length; k++) {
            const p = noiseParties[k];
            perturbedSwings[p] =
              (scenario.manualSwings[p] ?? 0) + (epsBuf[k] - meanEps);
          }
          sampleScenario = { ...scenario, manualSwings: perturbedSwings };
        }
      }

      const onpEngagedSample =
        "onp" in sampleScenario.manualSwings ||
        Object.keys(sampleScenario.onpDemographic).length > 0;

      // Statewide ONP target from CURRENT (per-sample) swings.
      const aggOnp = aggregateLaPrimaries(baseline.la.seats, sampleScenario, {
        bucketIndies: false,
      });
      const totalOnp = Object.values(aggOnp).reduce((a, b) => a + b, 0);
      const statewideOnpPct =
        totalOnp > 0 ? ((aggOnp.onp ?? 0) / totalOnp) * 100 : 0;

      const resolvedOnpDemo = resolveOnpDemographic(
        statewideOnpPct,
        sampleScenario.onpDemographic,
        demoStats,
      );
      const resolvedOnpDemoForModel = onpEngagedSample
        ? resolvedOnpDemo
        : undefined;

      // Mirror the deterministic path (SeatsModel): when ONP demographic pinning
      // is engaged, rake the per-seat primaries so every other party's STATEWIDE
      // total is held flat. Raked per draw because each draw's perturbed swings
      // move the targets.
      const laRake = resolvedOnpDemoForModel
        ? rakeLaOnpDemographic(
            baseline.la.seats,
            sampleScenario,
            resolvedOnpDemoForModel,
          )
        : null;
      const laRakedPrimaries =
        laRake && laRake.feasible ? laRake.primaries : undefined;

      const laResults = runAllLaIrv(
        baseline.la.seats,
        baseline.preferenceFlows,
        sampleScenario,
        resolvedOnpDemoForModel,
        laRakedPrimaries,
      );
      const lcResults = runAllLcStv(baseline.lc.regions, sampleScenario);
      const laTally = tallySeats(laResults, fold);
      const lcTally = tallyLcSeats(lcResults, fold);

      // 2026-projected first-pref votes (uniform demographic scaling). Emitted
      // raw so the driver can apply its own funding model.
      const aggLa = aggregateLaPrimaries(baseline.la.seats, sampleScenario, {
        bucketIndies: false,
        resolvedOnpDemo: resolvedOnpDemoForModel,
        rakedPrimaries: laRakedPrimaries,
      });
      const aggLc = aggregateLcPrimaries(baseline.lc.regions, sampleScenario, {
        bucketIndies: false,
      });

      if (completed === 0) lastHash = hashTally(laTally, lcTally);

      if (collectTallies) {
        for (const [k, v] of Object.entries(laTally)) {
          (laTallies[k] ??= []).push(v);
        }
        for (const [k, v] of Object.entries(lcTally)) {
          (lcTallies[k] ??= []).push(v);
        }
        for (const [k, v] of Object.entries(aggLa)) {
          (lhVotes[k] ??= []).push(v * scaling);
        }
        for (const [k, v] of Object.entries(aggLc)) {
          (uhVotes[k] ??= []).push(v * scaling);
        }
      }

      completed += 1;

      if (progressEvery > 0 && completed % progressEvery === 0) {
        const progress: BenchProgressMessage = {
          type: "progress",
          workerId,
          samplesDone: completed,
        };
        (self as unknown as Worker).postMessage(progress);
      }
    }
    // End of batch. Post an interim snapshot if enough wall-clock has elapsed.
    const nowMs = Date.now();
    if (
      collectTallies &&
      completed > lastInterimSamples &&
      nowMs - lastInterimMs >= INTERIM_INTERVAL_MS
    ) {
      const interim: BenchInterimMessage = {
        type: "interim",
        workerId,
        nSamples: completed,
        elapsedMs: performance.now() - t0,
        laTallies,
        lcTallies,
        lhVotes,
        uhVotes,
      };
      (self as unknown as Worker).postMessage(interim);
      lastInterimMs = nowMs;
      lastInterimSamples = completed;
    }

    if (token !== currentToken) return;
    await yieldToEventLoop();
    batchStartMs = Date.now();
  }

  if (token !== currentToken) return;
  activeDeadline = null;

  const elapsedMs = performance.now() - t0;
  const done: BenchDoneMessage = {
    type: "done",
    workerId,
    nSamples: completed,
    elapsedMs,
    resultHash: lastHash,
    ...(collectTallies ? { laTallies, lcTallies, lhVotes, uhVotes } : {}),
  };
  (self as unknown as Worker).postMessage(done);
}
