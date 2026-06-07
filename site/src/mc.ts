// Monte Carlo controller. Drives a POOL of the engine's Web Workers (one per
// core) for a fixed time budget, streaming per-sample Assembly seat tallies off
// the main thread. We perturb the primary swings by the multinomial sampling
// covariance (Technique A — same as examples/basic.ts) and summarise the live
// distribution into per-party seat whiskers + P(Labor majority). Each worker
// posts `interim` snapshots so the bands visibly fill in; CSS transitions
// animate them smoothly.

import {
  aggregateLaPrimaries,
  buildMultinomialCholesky,
  computeQuantiles,
  type QuantileStats,
} from "@tally";
import { DATA, LA_MAJORITY } from "./engine";
import type { ScenarioState } from "@tally";

// Worker fold folds BOTH Coalition partners into one "coa" row so each sample's
// tally already carries the combined Coalition seat count — letting us take
// honest quantiles for it (we can't elementwise-sum the sparse per-party
// arrays after the fact).
const MC_FOLD_SPEC = {
  exact: { lib: "coa", nat: "coa", coa: "coa" },
  prefix: [["ind_", "ind"]] as Array<[string, string]>,
};

const NOISE_PARTIES = ["alp", "lib", "nat", "grn", "onp", "oth"];
const POLL_N = 1000; // effective poll sample size → per-party σ
const SEED = 0x1d8b7;
const DURATION_MS = 5000; // time budget per run
const MAX_WORKERS = 12;

// 95% margin of error of the simulated poll noise driving each draw, in
// percentage points (worst case at p = 0.5): 1.96·√(0.25/n).
export const MOE_PP = 1.96 * Math.sqrt(0.25 / POLL_N) * 100;

// One worker per core, leaving one free for the main thread / UI.
function poolSize(): number {
  const hc = navigator.hardwareConcurrency || 4;
  return Math.max(1, Math.min(hc - 1, MAX_WORKERS));
}

export interface McStats {
  samples: number;
  running: boolean;
  cores: number;
  pMajority: number; // P(Labor ≥ 45 Assembly seats), 0..1
  laWhiskers: Record<string, QuantileStats>; // Assembly: party → seat quantiles
  lcWhiskers: Record<string, QuantileStats>; // Council:  party → seat quantiles
}

export interface McController {
  available: boolean;
  cores: number;
  run(scenario: ScenarioState): void;
  stop(): void;
}

export function createMonteCarlo(handlers: {
  onStats: (s: McStats) => void;
  onProgress: (fraction: number, running: boolean) => void;
}): McController {
  const cores = poolSize();
  let available = true;
  const workers: Worker[] = [];
  const sentBaseline: boolean[] = [];

  // Latest cumulative tallies per worker (each `interim`/`done` carries the
  // FULL accumulated set for that worker, not a delta).
  const latest = new Map<
    number,
    { la: Record<string, number[]>; lc: Record<string, number[]>; n: number }
  >();
  let doneCount = 0;
  let running = false;
  let startMs = 0;
  let raf = 0;

  try {
    for (let i = 0; i < cores; i++) {
      const w = new Worker(
        new URL("../../src/mc/montecarlo.worker.ts", import.meta.url),
        { type: "module" },
      );
      const id = i;
      w.onmessage = (e: MessageEvent) => onMessage(id, e.data);
      w.onerror = () => {
        available = false;
        stopRaf();
        handlers.onStats({
          samples: 0,
          running: false,
          cores,
          pMajority: NaN,
          laWhiskers: {},
          lcWhiskers: {},
        });
      };
      workers.push(w);
      sentBaseline.push(false);
    }
  } catch {
    available = false;
  }

  function onMessage(id: number, msg: any) {
    if (msg.type !== "interim" && msg.type !== "done") return;
    latest.set(id, {
      la: msg.laTallies ?? {},
      lc: msg.lcTallies ?? {},
      n: msg.nSamples ?? 0,
    });
    if (msg.type === "done") doneCount++;
    if (doneCount >= workers.length && running) {
      running = false;
      stopRaf();
      handlers.onProgress(1, false);
    }
    handlers.onStats(summarise());
  }

  // Merge one chamber's per-worker arrays and take quantiles over the pool.
  function whiskersFor(
    pick: (w: { la: Record<string, number[]>; lc: Record<string, number[]> }) =>
      Record<string, number[]>,
    samples: number,
  ): Record<string, QuantileStats> {
    const merged: Record<string, number[]> = {};
    for (const w of latest.values()) {
      for (const [k, arr] of Object.entries(pick(w))) {
        (merged[k] ??= []).push(...arr);
      }
    }
    const out: Record<string, QuantileStats> = {};
    for (const [id, arr] of Object.entries(merged)) {
      // The worker only pushes present (nonzero) entries; pad with zeros up to
      // the total sample count so the quantile multiset includes the draws
      // where the party won no seats. Order is irrelevant — computeQuantiles
      // sorts.
      const padded =
        arr.length < samples
          ? arr.concat(new Array(samples - arr.length).fill(0))
          : arr;
      const q = computeQuantiles(padded);
      if (q) out[id] = q;
    }
    return out;
  }

  function summarise(): McStats {
    let samples = 0;
    for (const { n } of latest.values()) samples += n;

    const laWhiskers = whiskersFor((w) => w.la, samples);
    const lcWhiskers = whiskersFor((w) => w.lc, samples);

    // P(Labor majority) — Assembly only.
    const alp: number[] = [];
    for (const w of latest.values()) if (w.la.alp) alp.push(...w.la.alp);
    const pMajority =
      samples > 0 ? alp.filter((n) => n >= LA_MAJORITY).length / samples : 0;

    return { samples, running, cores, pMajority, laWhiskers, lcWhiskers };
  }

  function tick() {
    if (!running) return;
    const frac = Math.min(1, (performance.now() - startMs) / DURATION_MS);
    handlers.onProgress(frac, true);
    raf = requestAnimationFrame(tick);
  }
  function stopRaf() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  function run(scenario: ScenarioState) {
    if (!available || workers.length === 0) return;

    // Shares for the noise covariance, from the CURRENT scenario's aggregate.
    const agg = aggregateLaPrimaries(DATA.la.seats, scenario, {
      bucketIndies: false,
    });
    const total = Object.values(agg).reduce((a, b) => a + b, 0);
    const shares = NOISE_PARTIES.map((p) =>
      total > 0 ? (agg[p] ?? 0) / total : 0,
    );
    const cholesky = buildMultinomialCholesky(shares, POLL_N);

    // Reset accumulators and (re)start the budget. Posting a fresh "run"
    // preempts any in-flight run (each worker bumps its token).
    latest.clear();
    doneCount = 0;
    running = true;
    startMs = performance.now();
    const deadlineEpochMs = Date.now() + DURATION_MS;

    workers.forEach((w, i) => {
      w.postMessage({
        type: "run",
        workerId: i,
        nSamples: Number.MAX_SAFE_INTEGER, // bounded by the deadline instead
        scenario,
        progressEvery: 0,
        baseline: sentBaseline[i] ? undefined : DATA,
        scaling: 1,
        fold: MC_FOLD_SPEC,
        // Distinct seed per worker so the streams don't overlap (see the
        // per-worker seed note in src/mc/messages.ts).
        noise: { cholesky, parties: NOISE_PARTIES, seed: SEED + i * 1_000_000 },
        collectTallies: true,
        deadlineEpochMs,
      });
      sentBaseline[i] = true;
    });

    handlers.onProgress(0, true);
    stopRaf();
    raf = requestAnimationFrame(tick);
  }

  function stop() {
    running = false;
    stopRaf();
    // Move every worker's deadline into the past so it ends at its next yield.
    for (const w of workers) {
      w.postMessage({ type: "update-deadline", deadlineEpochMs: 0 });
    }
  }

  return { available, cores, run, stop };
}
