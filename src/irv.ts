import type {
  Demographic,
  FlowRow,
  IrvResult,
  IrvRound,
  PartyId,
  PreferenceFlows,
  ScenarioState,
  SeatBaseline,
} from "./types";
import { applySwingForSeat, mergeFlowOverrides } from "./scenario";

// Run IRV for a single LA seat.
//
// Algorithm:
//   1. Apply scenario swing to baseline primaries → starting tallies.
//   2. While more than one candidate remains, eliminate the lowest-tally
//      candidate; distribute their votes to surviving candidates per the
//      flow matrix row for that party (re-normalised over survivors so
//      mass is preserved; exhaust assumed 0 in LA).
//   3. Return final winner, full round-by-round trail.
export function runLaIrv(
  seat: SeatBaseline,
  flows: PreferenceFlows,
  scenario: ScenarioState,
  resolvedOnpDemo?: Record<Demographic, number>,
  // When supplied (from the chamber-wide ON demographic raking pass), these
  // replace the per-seat `applySwingForSeat` result — so the seat count and
  // the funding aggregate run off the same raked primaries.
  precomputedPrimaries?: Record<PartyId, number>,
  // Optional-preferential voting (NSW): when true, a flow row that sums to less
  // than 1 exhausts the remainder rather than conserving it across survivors.
  // Default false keeps full-preferential behaviour (VIC / federal rows sum to
  // ~1, so this changes nothing for them).
  allowExhaust = false,
): IrvResult {
  const baselineWinner = seat.twoCp.winner;
  // Layer per-seat YAML overrides BENEATH scenario user overrides:
  // scenario wins, because the user is actively poking the model with
  // full knowledge.
  const seatMatrix: Record<PartyId, FlowRow> = seat.preferenceOverrides
    ? { ...flows.matrix, ...(seat.preferenceOverrides as Record<PartyId, FlowRow>) }
    : flows.matrix;
  const matrix = mergeFlowOverrides(
    { matrix: seatMatrix },
    scenario.flowOverrides,
  );

  const initial =
    precomputedPrimaries ??
    applySwingForSeat(seat, scenario.manualSwings, resolvedOnpDemo);

  let tallies: Record<PartyId, number> = { ...initial };
  const rounds: IrvRound[] = [
    { index: 0, tallies: { ...tallies } },
  ];

  let safety = 0;
  while (safety++ < 50) {
    const survivors = Object.entries(tallies).filter(([, v]) => v > 0);
    if (survivors.length <= 1) break;

    // If anyone already > 50% of remaining, we can stop early.
    const total = survivors.reduce((a, [, v]) => a + v, 0);
    const leader = survivors.reduce((a, b) => (a[1] >= b[1] ? a : b));
    if (leader[1] / total > 0.5) break;

    // Eliminate lowest.
    const loser = survivors.reduce((a, b) => (a[1] <= b[1] ? a : b));
    const eliminated = loser[0];
    const eliminatedVotes = loser[1];

    const row: FlowRow | undefined = matrix[eliminated];
    const transfers: Record<PartyId, number> = {};

    // Build a flow distribution over survivors (excluding the eliminated).
    const candidates = survivors
      .map(([p]) => p)
      .filter((p) => p !== eliminated);

    // Distribute the row across survivors. Any "leftover" row mass —
    // weight that points at destinations no longer standing (already
    // eliminated, or absent from the seat altogether, e.g. an indie not
    // mentioned in a statewide row) — is redistributed evenly across ALL
    // survivors. This keeps mass conserved without privileging the
    // happen-to-be-listed survivors over equally plausible recipients
    // (the typical case: a notable indie absent from a statewide row).
    const weights: Record<PartyId, number> = {};
    let matchedMass = 0;
    for (const c of candidates) {
      const w = row?.flows[c] ?? 0;
      weights[c] = w;
      matchedMass += w;
    }
    const totalRowMass = row
      ? Object.values(row.flows).reduce((a, b) => a + b, 0)
      : 1;
    const leftover = Math.max(0, totalRowMass - matchedMass);
    const perSurvivor = leftover / Math.max(1, candidates.length);
    for (const c of candidates) weights[c] += perSurvivor;
    let weightSum = matchedMass + leftover;
    if (weightSum <= 0) {
      // Defensive fallback — should never trigger when totalRowMass >= 0.
      const share = 1 / Math.max(1, candidates.length);
      for (const c of candidates) {
        weights[c] = share;
        weightSum += share;
      }
    }

    const next: Record<PartyId, number> = {};
    for (const [p, v] of survivors) {
      if (p === eliminated) continue;
      // Full-preferential normalises to weightSum (all votes transfer);
      // optional-preferential transfers only the row's specified mass (weights
      // already sum to the row total ≤ 1) and exhausts the remainder.
      const transfer = allowExhaust
        ? eliminatedVotes * weights[p]
        : eliminatedVotes * (weights[p] / weightSum);
      next[p] = v + transfer;
      transfers[p] = transfer;
    }

    tallies = next;
    rounds.push({
      index: rounds.length,
      tallies: { ...tallies },
      eliminated,
      transfers,
    });
  }

  const finalEntries = Object.entries(tallies).filter(([, v]) => v > 0);
  const sorted = [...finalEntries].sort((a, b) => b[1] - a[1]);
  const winner = sorted[0]?.[0] ?? baselineWinner;
  const runnerUp = sorted[1]?.[0] ?? winner;
  const finalTotal = finalEntries.reduce((a, [, v]) => a + v, 0);
  const finalPct = finalTotal > 0 ? (sorted[0][1] / finalTotal) * 100 : 0;

  return {
    seatId: seat.id,
    winner,
    runnerUp,
    finalPct,
    rounds,
    baselineWinner,
    changedFromBaseline: winner !== baselineWinner,
  };
}

// Run IRV across all LA seats; returns map seatId → result.
export function runAllLaIrv(
  seats: SeatBaseline[],
  flows: PreferenceFlows,
  scenario: ScenarioState,
  resolvedOnpDemo?: Record<Demographic, number>,
  // Raked per-seat primaries (seatId → primaries) from
  // `rakeLaOnpDemographic`. When present, each seat uses its raked row
  // instead of the per-seat demographic swing.
  rakedPrimaries?: Map<string, Record<PartyId, number>>,
  allowExhaust = false,
): Record<string, IrvResult> {
  const out: Record<string, IrvResult> = {};
  for (const seat of seats) {
    out[seat.id] = runLaIrv(
      seat,
      flows,
      scenario,
      resolvedOnpDemo,
      rakedPrimaries?.get(seat.id),
      allowExhaust,
    );
  }
  return out;
}

// Reduce per-seat results to a per-party seat tally. Winners are counted under
// their RAW id by default; pass a `fold` to bucket ids (the Victorian model
// folds coa→lib and ind_*→ind — see lib/seats/party-fold.ts). Keeping the
// engine fold-free lets each jurisdiction supply its own party vocabulary.
export function tallySeats(
  results: Record<string, IrvResult>,
  fold: (id: PartyId) => PartyId = (id) => id,
): Record<PartyId, number> {
  const tally: Record<PartyId, number> = {};
  for (const r of Object.values(results)) {
    const key = fold(r.winner);
    tally[key] = (tally[key] ?? 0) + 1;
  }
  return tally;
}
