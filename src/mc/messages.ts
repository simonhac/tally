// Message contract between the Monte Carlo worker and its driver. Pure type
// definitions — no runtime code, safe to import from anywhere (the worker
// module itself touches Web Worker globals and must only be loaded by URL).
//
// The worker is ELECTORAL-ONLY: it returns per-sample seat tallies and per-sample
// vote aggregates by party. It knows nothing about funding — the driver applies
// any jurisdiction's funding model to the vote/seat output afterward.

import type { PartyId, ScenarioState, Vic2022Data } from "../types";

// Per-sample noise added to the base swings. Two modes:
//
//   - Multinomial covariance (Technique A): the driver Cholesky-factorises the
//     (k-1)×(k-1) leading principal minor of the multinomial covariance matrix
//     and ships the lower-triangular factor L as `cholesky`. The worker samples
//     k-1 standard normals z, computes ε = L·z for i < k-1, and recovers the
//     k-th as −Σε. Proper σ AND the correct negative-correlation structure;
//     zero-sum is automatic.
//
//   - Independent Gaussians + projection (Technique B): sample ε_p ~ N(0, σ_p²)
//     independently, subtract the mean to project onto the zero-sum hyperplane.
//     Coarser, but simpler. Still used by the diagnostic bench page.
//
// Exactly one of `sigmaPp` / `cholesky` should be set.
export interface NoiseConfig {
  // Technique B input.
  sigmaPp?: Partial<Record<PartyId, number>>;
  // Technique A input: lower-triangular Cholesky factor of the (k-1)×(k-1)
  // covariance minor, row-major flat array of length (k-1)². Upper triangle
  // is ignored.
  cholesky?: number[];
  // Party order matching the Cholesky / sigmaPp. With cholesky, ε is sampled
  // for the first k-1 parties and the k-th absorbs the residual.
  parties: PartyId[];
  // Per-worker seed for mulberry32. Choose one large enough that the streams
  // don't overlap across workers (e.g. seed_k = base + k*1e6).
  seed: number;
}

// Serializable party-fold applied per sample to the seat tallies BEFORE they are
// accumulated. `exact[id]` wins; otherwise the first `[prefix, target]` whose
// prefix the id starts with; otherwise the id is kept unchanged. Absent spec =
// identity (raw winner counts). The fold MUST be a data spec, not a function,
// because it crosses the worker boundary. Jurisdiction fold rules live in the
// app (e.g. lib/seats/party-fold.ts) and are passed in here.
export interface FoldSpec {
  exact?: Record<string, string>;
  prefix?: Array<[string, string]>;
}

export interface BenchRunMessage {
  type: "run";
  workerId: number;
  // Maximum samples to run. Used as an upper bound; if `deadlineEpochMs` is
  // also set, the loop terminates on whichever stops first.
  nSamples: number;
  scenario: ScenarioState;
  progressEvery: number; // post a progress heartbeat every N samples
  // The first message a worker receives MUST include baseline + scaling;
  // subsequent messages MAY omit them (the worker caches them). Supports both
  // spawn-per-trial and pool-reuse calling patterns.
  baseline?: Vic2022Data;
  scaling?: number;
  // Per-sample fold for the seat tallies. Omit for raw (identity).
  fold?: FoldSpec;
  // When present, every sample perturbs the swings by a fresh draw. When
  // absent, the deterministic pipeline runs.
  noise?: NoiseConfig;
  // When true, the worker accumulates per-sample LA/LC seat tallies and vote
  // aggregates and returns them with the done message.
  collectTallies?: boolean;
  // Absolute Date.now()-style wall-clock deadline. When set, every worker stops
  // at the same wall-clock instant regardless of when it got scheduled.
  deadlineEpochMs?: number;
}

export interface BenchProgressMessage {
  type: "progress";
  workerId: number;
  samplesDone: number;
}

// Periodic cumulative snapshot of this worker's accumulated tallies/votes so the
// driver can animate the whisker overlay as samples stream in. Each message
// contains the FULL set accumulated so far (not a delta).
export interface BenchInterimMessage {
  type: "interim";
  workerId: number;
  nSamples: number;
  elapsedMs: number;
  laTallies: Record<string, number[]>;
  lcTallies: Record<string, number[]>;
  lhVotes: Record<string, number[]>;
  uhVotes: Record<string, number[]>;
}

// Sent from the driver to update the deadline of an in-flight run without
// restarting it (budget extend / truncate). Picked up on the worker's next
// batch yield.
export interface BenchUpdateDeadlineMessage {
  type: "update-deadline";
  deadlineEpochMs: number;
}

export type BenchInMessage = BenchRunMessage | BenchUpdateDeadlineMessage;

export interface BenchDoneMessage {
  type: "done";
  workerId: number;
  nSamples: number;
  elapsedMs: number;
  // Hash of the FIRST tally — cross-worker determinism check when noise is off.
  resultHash: string;
  // Present when run with collectTallies=true. One entry per sample, keyed by
  // (possibly folded) party id. Sparse — only keys with at least one nonzero
  // value appear.
  laTallies?: Record<string, number[]>;
  lcTallies?: Record<string, number[]>;
  // Per-sample projected first-pref vote aggregates by party (scaled), both
  // chambers. The driver applies its funding model to these post-hoc.
  lhVotes?: Record<string, number[]>;
  uhVotes?: Record<string, number[]>;
}

export type BenchOutMessage =
  | BenchProgressMessage
  | BenchInterimMessage
  | BenchDoneMessage;
