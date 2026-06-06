import type {
  Demographic,
  FlowRow,
  PartyId,
  PreferenceFlows,
  ScenarioState,
  SeatBaseline,
} from "./types";

export const DEMOGRAPHICS: readonly Demographic[] = [
  "Inner Metropolitan",
  "Outer Metropolitan",
  "Provincial",
  "Rural",
] as const;

export const ONP_DEMO_MIN = 0;
export const ONP_DEMO_MAX = 50;

export const emptyScenario = (): ScenarioState => ({
  manualSwings: {},
  flowOverrides: {},
  onpDemographic: {},
});

// Apply per-party manual swings to a seat's primary tallies.
//
// Model: parties whose id appears in `manualSwings` are "manual" — their
// share moves by exactly the dialled pp. Parties not in the map are
// "automatic" — together they absorb the opposite of the total manual
// swing, split between them in proportion to their base share. Vote
// totals are conserved.
//
// Edge cases: if every party in this seat is manual there is no absorber;
// if a manual dial pushes an auto absorber below zero we clamp and then
// renormalise to the original `formal`, so the seat total stays right
// even if the manual values don't literally sum to zero.
export function applySwing(
  primaries: Record<PartyId, number>,
  manualSwings: Record<PartyId, number>,
): Record<PartyId, number> {
  const formal = Object.values(primaries).reduce((a, b) => a + b, 0);
  if (formal <= 0) return { ...primaries };

  // Manual sum draws from every dialled slider, including parties absent
  // from this seat's baseline primaries (e.g. One Nation in 2022 LA where
  // they were bucketed into "oth"). Their baseShare is 0, but their dial
  // still moves vote mass off the auto absorbers.
  let manualSum = 0;
  for (const value of Object.values(manualSwings)) {
    manualSum += value / 100;
  }

  let autoBaseShare = 0;
  for (const [party, votes] of Object.entries(primaries)) {
    if (!(party in manualSwings)) autoBaseShare += votes / formal;
  }

  const adjusted: Record<PartyId, number> = {};
  // Union of baseline parties and manually-dialled parties; missing-from-
  // baseline manuals enter at baseShare = 0.
  const partyKeys = new Set<PartyId>([
    ...Object.keys(primaries),
    ...Object.keys(manualSwings),
  ]);
  for (const party of partyKeys) {
    const votes = primaries[party] ?? 0;
    const baseShare = votes / formal;
    let newShare: number;
    if (party in manualSwings) {
      newShare = baseShare + manualSwings[party] / 100;
    } else if (autoBaseShare > 0) {
      newShare = baseShare - manualSum * (baseShare / autoBaseShare);
    } else {
      newShare = baseShare;
    }
    // Belt-and-braces: clamp every share to [0, 1] before renormalising,
    // so no party can sit outside its physically-possible range.
    adjusted[party] = Math.min(1, Math.max(0, newShare));
  }

  const sum = Object.values(adjusted).reduce((a, b) => a + b, 0);
  if (sum <= 0) return { ...primaries };
  const result: Record<PartyId, number> = {};
  for (const [party, share] of Object.entries(adjusted)) {
    // Renormalise to seat formal, then clamp again to [0, formal] to
    // absorb any floating-point residue that pushes a value sub-zero
    // or fractionally above the seat total.
    const v = (share / sum) * formal;
    result[party] = Math.min(formal, Math.max(0, v));
  }
  return result;
}

// Display value for an automatic slider: the pp it would absorb given
// chamber-aggregate primaries. Per-seat absorption varies seat-by-seat;
// this is the panel-level summary.
export function autoSwingDisplay(
  aggregatedPrimaries: Record<PartyId, number>,
  manualSwings: Record<PartyId, number>,
): Record<PartyId, number> {
  const formal = Object.values(aggregatedPrimaries).reduce((a, b) => a + b, 0);
  if (formal <= 0) return {};

  let manualSum = 0;
  for (const party of Object.keys(aggregatedPrimaries)) {
    if (party in manualSwings) manualSum += manualSwings[party] / 100;
  }

  let autoBaseShare = 0;
  for (const [party, votes] of Object.entries(aggregatedPrimaries)) {
    if (!(party in manualSwings)) autoBaseShare += votes / formal;
  }

  const display: Record<PartyId, number> = {};
  if (autoBaseShare <= 0) return display;
  for (const [party, votes] of Object.entries(aggregatedPrimaries)) {
    if (party in manualSwings) continue;
    const baseShare = votes / formal;
    display[party] = -manualSum * (baseShare / autoBaseShare) * 100;
  }
  return display;
}

// Per-demographic formal-vote share. `weights` sums to 1 (some demographics
// may be 0 if no seats have that classification).
export interface DemoStats {
  weights: Record<Demographic, number>;
}

export function computeDemoStats(seats: SeatBaseline[]): DemoStats {
  const formalIn: Record<Demographic, number> = {
    "Inner Metropolitan": 0,
    "Outer Metropolitan": 0,
    Provincial: 0,
    Rural: 0,
  };
  let totalFormal = 0;
  for (const seat of seats) {
    if (!seat.demographic) continue;
    formalIn[seat.demographic] += seat.formal;
    totalFormal += seat.formal;
  }
  const weights: Record<Demographic, number> = {
    "Inner Metropolitan": 0,
    "Outer Metropolitan": 0,
    Provincial: 0,
    Rural: 0,
  };
  for (const d of DEMOGRAPHICS) {
    weights[d] = totalFormal > 0 ? formalIn[d] / totalFormal : 0;
  }
  return { weights };
}

// Resolve the four displayed demographic ON values. Pinned demographics
// take their map value. Automatic demographics share the residual mass
// (target − pinned) equally — all automatic demographics show the same
// value. Values are clamped to [0, 50]; clamping may cause the resolved
// weighted average to drift from the target.
export function resolveOnpDemographic(
  statewideOnpTargetPct: number,
  pinned: Partial<Record<Demographic, number>>,
  stats: DemoStats,
): Record<Demographic, number> {
  const { weights } = stats;
  let pinnedMass = 0;
  for (const d of DEMOGRAPHICS) {
    if (d in pinned) pinnedMass += (pinned[d] ?? 0) * weights[d];
  }
  const autoMass = statewideOnpTargetPct - pinnedMass;

  let autoWeight = 0;
  for (const d of DEMOGRAPHICS) {
    if (d in pinned) continue;
    autoWeight += weights[d];
  }
  const autoValue = autoWeight > 0 ? autoMass / autoWeight : 0;

  const resolved: Record<Demographic, number> = {
    "Inner Metropolitan": 0,
    "Outer Metropolitan": 0,
    Provincial: 0,
    Rural: 0,
  };
  for (const d of DEMOGRAPHICS) {
    const v = d in pinned ? (pinned[d] ?? 0) : autoValue;
    resolved[d] = clamp(v, ONP_DEMO_MIN, ONP_DEMO_MAX);
  }
  return resolved;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

// Apply scenario swings to a single seat. When `resolvedOnpDemo` is
// supplied and the seat has a demographic, ONP's slider-dialled swing
// is replaced with a per-seat ONP swing derived from the demographic
// target (`demoTarget − baselineOnpShare`); everything then goes
// through the uniform `applySwing` alongside the other dialled swings.
//
// Why: `resolveOnpDemographic` constructs demographic targets so that
// their formal-vote-weighted average equals the slider's statewide ONP
// target. Routing the demographic shape through a per-seat ONP swing
// (instead of carving ONP out and rescaling the remainder) means every
// non-ONP party's dialled swing is preserved statewide — the chart, the
// funding table, and the seat IRV all see consistent vote aggregates.
// Without this, the previous carve-then-scale path silently deflated
// every non-ONP party because the residual landed on the auto-absorber
// inside the non-ONP slice and then got scaled down by `(1 − onpShare)`.
export function applySwingForSeat(
  seat: SeatBaseline,
  manualSwings: Record<PartyId, number>,
  resolvedOnpDemo?: Record<Demographic, number>,
): Record<PartyId, number> {
  if (!resolvedOnpDemo || !seat.demographic) {
    return applySwing(seat.primaries, manualSwings);
  }
  if (seat.formal <= 0) return { ...seat.primaries };

  const baselineOnpShare = (seat.primaries.onp ?? 0) / seat.formal;
  const onpSwingForSeat =
    resolvedOnpDemo[seat.demographic] - baselineOnpShare * 100;
  return applySwing(seat.primaries, {
    ...manualSwings,
    onp: onpSwingForSeat,
  });
}

// Merge sparse user overrides onto the baseline flow matrix.
// An override row replaces the entire baseline row for that source party.
export function mergeFlowOverrides(
  base: PreferenceFlows,
  overrides: ScenarioState["flowOverrides"],
): Record<PartyId, FlowRow> {
  const out: Record<PartyId, FlowRow> = { ...base.matrix };
  for (const [src, flows] of Object.entries(overrides)) {
    const baseRow = base.matrix[src];
    out[src] = {
      source: baseRow?.source ?? "(user override)",
      assumption: "User override",
      flows: { ...flows },
    };
  }
  return out;
}

// --------------- Reducer ---------------

export type ScenarioAction =
  | { type: "set-swing"; party: PartyId; value: number }
  | { type: "release-swing"; party: PartyId }
  | { type: "set-swings"; swings: Record<PartyId, number> }
  | { type: "set-flow"; src: PartyId; dest: PartyId; value: number }
  | { type: "reset-flow-row"; src: PartyId }
  | { type: "set-onp-demo"; demographic: Demographic; value: number }
  | { type: "release-onp-demo"; demographic: Demographic }
  | { type: "reset-onp-demo" }
  | { type: "reset-all" };

export function scenarioReducer(
  state: ScenarioState,
  action: ScenarioAction,
): ScenarioState {
  switch (action.type) {
    case "set-swing": {
      // A pinned-at-0 slider stays manual until explicitly released; do
      // not delete the key on value === 0.
      const manualSwings = {
        ...state.manualSwings,
        [action.party]: action.value,
      };
      return { ...state, manualSwings };
    }
    case "release-swing": {
      const manualSwings = { ...state.manualSwings };
      delete manualSwings[action.party];
      return { ...state, manualSwings };
    }
    case "set-swings":
      return { ...state, manualSwings: { ...action.swings } };
    case "set-flow": {
      const row = { ...(state.flowOverrides[action.src] ?? {}) };
      row[action.dest] = action.value;
      const flowOverrides = { ...state.flowOverrides, [action.src]: row };
      return { ...state, flowOverrides };
    }
    case "reset-flow-row": {
      const flowOverrides = { ...state.flowOverrides };
      delete flowOverrides[action.src];
      return { ...state, flowOverrides };
    }
    case "set-onp-demo": {
      const onpDemographic = {
        ...state.onpDemographic,
        [action.demographic]: action.value,
      };
      return { ...state, onpDemographic };
    }
    case "release-onp-demo": {
      const onpDemographic = { ...state.onpDemographic };
      delete onpDemographic[action.demographic];
      return { ...state, onpDemographic };
    }
    case "reset-onp-demo":
      return { ...state, onpDemographic: {} };
    case "reset-all":
      return emptyScenario();
  }
}
