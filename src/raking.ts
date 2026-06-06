import { applySwing, applySwingForSeat } from "./scenario";
import type {
  Demographic,
  PartyId,
  ScenarioState,
  SeatBaseline,
} from "./types";

// One Nation demographic pinning via iterative proportional fitting (raking).
//
// The problem: the user pins ON's primary share by region. ON's statewide
// total is conserved (`resolveOnpDemographic` builds the four regional
// targets so their formal-vote-weighted average equals the slider's
// statewide ON %), but its *geography* is reshaped — higher in Rural,
// lower in Metro.
//
// The naive per-seat path (`applySwingForSeat` with a demographic) makes the
// undialled parties in each seat absorb ON's local swing proportional to
// their local share. Because ON's reshape is geographically uneven, that
// silently moves every other party's STATEWIDE total: a party concentrated
// where ON surges (e.g. the Nationals, rural independents) loses more than
// it recovers elsewhere. See the header comment in `scenario.ts`.
//
// What we want instead, holding each seat's formal total fixed and each
// seat's ON cell pinned to its demographic target:
//   1. every party's STATEWIDE total equals its *clean* dialled target —
//      `baseShare + swing` applied once to the aggregate, NOT the drifted sum
//      of per-seat `applySwingForSeat` (the "ledger" matches the input), and
//   2. we never invent presence — a party with zero votes in a seat stays
//      at zero.
//
// (1) is the methodological contract behind the One Nation story: the chart,
// the seat tally and the funding all read this raked table back as the
// projected primary vote, so that aggregate must equal what was dialled. The
// old column targets summed per-seat `applySwingForSeat`, which clamps and
// renormalises each seat and so drifts off the input under any large swing.
//
// That is a two-marginal table-fitting problem. Raking (IPF) solves it:
// rescale each party's existing per-seat votes, alternately, to hit the
// per-seat non-ON mass (rows) and each party's clean statewide total
// (columns). It is multiplicative, so zero cells stay zero (requirement 2),
// and it converges to the unique fit honouring both marginal sets
// (requirement 1) whenever they are consistent.
//
// The ON swing slider sets ON's statewide *level*; the demographic pins are
// a *shape* around it. We honour both by treating the pins as relative and
// rescaling them (demo seats only) so ON's statewide total exactly equals the
// clean ON target — preserving the level AND the user's regional pattern. This
// also makes the two marginal sets consistent, so raking converges to an exact
// fit (±1 vote).
//
// The one genuine failure is when the pins drag ON materially off its dialled
// level — e.g. every region pinned near 50% while the level is ~23%. Then the
// shape-rescale would badly distort the regional pattern, and `feasible` comes
// back false so the caller warns and falls back.

export interface RakeResult {
  // seatId → raked per-seat primaries (non-ON cells fitted, ON cell pinned).
  primaries: Map<string, Record<PartyId, number>>;
  // False when the pins drag ON's statewide total materially off the dialled
  // level — the pinned shape can't be honoured without over-stretching it.
  // Callers should fall back to the per-seat path and warn.
  feasible: boolean;
  // |pinned ON total − clean ON target| over demographic seats, in votes,
  // before the level-preserving rescale.
  marginalGap: number;
  iterations: number;
  // Max remaining deviation from any marginal, in votes, at return.
  maxResidual: number;
}

// Max fractional stretch of the pinned ON shape (|onpScale − 1|) we tolerate
// before calling the configuration infeasible. The rescale always hits the
// dialled ON level exactly; this only bounds how far the *shape* is distorted
// to get there. Designed presets and auto-filled regions average to the level,
// so onpScale ≈ 1 (a percent or two). Pinning every region near 50% while the
// dialled level is ~23% needs onpScale ≈ 0.46 — caught here.
const MAX_ON_DRIFT = 0.25;

export function rakeLaOnpDemographic(
  seats: SeatBaseline[],
  scenario: ScenarioState,
  resolvedOnpDemo: Record<Demographic, number>,
  opts: { maxIter?: number; tol?: number } = {},
): RakeResult {
  const maxIter = opts.maxIter ?? 10_000;
  const tol = opts.tol ?? 0.25; // votes

  // Uniform per-seat result (same manual swings, no demographic). The
  // realistic starting point (seed) for the non-ON cells — it preserves each
  // seat's geography (zeros stay zero, strong-where-strong) before raking.
  const uniformPerSeat = seats.map((s) =>
    applySwingForSeat(s, scenario.manualSwings),
  );

  // Clean statewide column targets. Apply the dialled swings ONCE to the
  // *aggregated* 2022 primaries — no per-seat clamping or renormalisation —
  // so every party's target is exactly its statewide `baseShare + swing`
  // (the auto-absorber carries the residual). This is the methodological
  // contract: the chart, the seat tally, and the funding all read the raked
  // table back as the projected primary vote, so that aggregate must equal
  // the dialled input. Summing per-seat `applySwingForSeat` instead (the old
  // column targets) silently drifts off these totals whenever a large swing
  // makes a seat clamp at 0 and renormalise — which is exactly what a poll
  // like the +23.5pp One Nation surge does in dozens of seats.
  const aggPrimaries: Record<PartyId, number> = {};
  for (const seat of seats) {
    for (const [party, v] of Object.entries(seat.primaries)) {
      aggPrimaries[party] = (aggPrimaries[party] ?? 0) + v;
    }
  }
  const cleanStatewide = applySwing(aggPrimaries, scenario.manualSwings);

  // Scale the clean targets to the seats' total formal vote so the row and
  // column marginals are exactly consistent (guards any primaries-vs-formal
  // rounding), which lets the IPF converge to an exact fit.
  const totalFormal = seats.reduce((a, s) => a + s.formal, 0);
  const cleanTotal = Object.values(cleanStatewide).reduce((a, b) => a + b, 0);
  const toFormal = cleanTotal > 0 ? totalFormal / cleanTotal : 1;

  // Column targets C[party]: each non-ON party's clean statewide total.
  const colTarget: Record<PartyId, number> = {};
  for (const [party, votes] of Object.entries(cleanStatewide)) {
    if (party === "onp") continue;
    colTarget[party] = votes * toFormal;
  }
  const parties = Object.keys(colTarget);
  const cleanOnpTarget = (cleanStatewide.onp ?? 0) * toFormal;

  // Raw pinned ON per seat (demo seats from the pins, any unclassified seat
  // held at its uniform value), and the demo/non-demo ON sub-totals used to
  // rescale the pinned shape onto the clean ON level.
  const onpRaw: number[] = [];
  let nonDemoOnp = 0;
  let demoRawOnp = 0;
  for (let s = 0; s < seats.length; s++) {
    const seat = seats[s];
    let onp: number;
    if (seat.demographic && seat.formal > 0) {
      onp = (resolvedOnpDemo[seat.demographic] / 100) * seat.formal;
      demoRawOnp += onp;
    } else {
      // No demographic classification → hold ON at its uniform value, so the
      // seat plays no part in the reshape.
      onp = uniformPerSeat[s].onp ?? 0;
      nonDemoOnp += onp;
    }
    onpRaw.push(onp);
  }

  // Level-preserving rescale: scale the demo-seat ON cells so ON's statewide
  // total exactly matches the clean ON target (shape kept, level pinned to the
  // dialled swing). This also makes the row and column marginals consistent so
  // the ledger comes out flat.
  const demoTargetOnp = cleanOnpTarget - nonDemoOnp;
  const onpScale = demoRawOnp > 0 ? demoTargetOnp / demoRawOnp : 1;

  // Infeasible only when the pins genuinely contradict the dialled ON level —
  // i.e. the shape must be stretched by more than MAX_ON_DRIFT to hit the
  // target, or the target would go negative. Designed presets (and the
  // auto-fill that sizes unpinned regions to the slider) average to the level,
  // so onpScale ≈ 1 and they pass. The caller falls back + warns when not.
  const marginalGap = Math.abs(demoRawOnp - demoTargetOnp);
  const feasible =
    cleanOnpTarget <= 0 ||
    (demoTargetOnp >= 0 && Math.abs(onpScale - 1) <= MAX_ON_DRIFT);
  const onpFixed: number[] = [];
  const rowTarget: number[] = [];
  // M[s] = non-ON cells for seat s, indexed parallel to `parties`.
  const M: number[][] = [];
  for (let s = 0; s < seats.length; s++) {
    const seat = seats[s];
    const onp =
      seat.demographic && seat.formal > 0 ? onpRaw[s] * onpScale : onpRaw[s];
    onpFixed.push(onp);
    rowTarget.push(seat.formal - onp);
    M.push(parties.map((p) => uniformPerSeat[s][p] ?? 0));
  }

  // IPF: alternately scale columns to colTarget and rows to rowTarget.
  let iterations = 0;
  let maxResidual = Infinity;
  for (; iterations < maxIter; iterations++) {
    // Column step → party statewide totals.
    const colSum = parties.map(() => 0);
    for (let s = 0; s < M.length; s++) {
      for (let j = 0; j < parties.length; j++) colSum[j] += M[s][j];
    }
    for (let j = 0; j < parties.length; j++) {
      if (colSum[j] <= 0) continue;
      const f = colTarget[parties[j]] / colSum[j];
      for (let s = 0; s < M.length; s++) M[s][j] *= f;
    }
    // Row step → per-seat non-ON mass. Measure residual on this pass.
    let rowResidual = 0;
    for (let s = 0; s < M.length; s++) {
      let rs = 0;
      for (let j = 0; j < parties.length; j++) rs += M[s][j];
      rowResidual = Math.max(rowResidual, Math.abs(rs - rowTarget[s]));
      if (rs <= 0) continue;
      const f = rowTarget[s] / rs;
      for (let j = 0; j < parties.length; j++) M[s][j] *= f;
    }
    // After the row step rows are exact; the column deviation is what's left.
    let colResidual = 0;
    const cs = parties.map(() => 0);
    for (let s = 0; s < M.length; s++) {
      for (let j = 0; j < parties.length; j++) cs[j] += M[s][j];
    }
    for (let j = 0; j < parties.length; j++) {
      colResidual = Math.max(colResidual, Math.abs(cs[j] - colTarget[parties[j]]));
    }
    maxResidual = Math.max(rowResidual, colResidual);
    if (maxResidual < tol) {
      iterations++;
      break;
    }
  }

  // Assemble output: raked non-ON cells + pinned ON cell.
  const primaries = new Map<string, Record<PartyId, number>>();
  for (let s = 0; s < seats.length; s++) {
    const row: Record<PartyId, number> = {};
    for (let j = 0; j < parties.length; j++) {
      if (M[s][j] !== 0) row[parties[j]] = M[s][j];
    }
    if (onpFixed[s] !== 0) row.onp = onpFixed[s];
    primaries.set(seats[s].id, row);
  }

  return { primaries, feasible, marginalGap, iterations, maxResidual };
}
