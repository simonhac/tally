// Thin adapter over the tally engine: loads the bundled 2022
// dataset, exposes the consumer "fold" (Victorian party bucketing), and wraps
// the deterministic seat projection. Everything visual builds on these.

import {
  aggregateLaPrimaries,
  aggregateLcPrimaries,
  computeDemoStats,
  rakeLaOnpDemographic,
  resolveOnpDemographic,
  resolveParty,
  runAllLaIrv,
  runAllLcStv,
  tallyLcSeats,
  tallySeats,
  type Demographic,
  type PartyId,
  type ResolvedParty,
  type ScenarioState,
  type Vic2022Data,
} from "@tally";
import raw from "../../examples/vic-2022.json";

export const DATA = raw as unknown as Vic2022Data;

export const LA_TOTAL = DATA.la.seats.length; // 88
export const LC_TOTAL = DATA.lc.regions.reduce((a, r) => a + r.seats, 0); // 40
export const LA_MAJORITY = Math.floor(LA_TOTAL / 2) + 1; // 45
export const LC_MAJORITY = Math.floor(LC_TOTAL / 2) + 1; // 21

export type Tally = Record<PartyId, number>;

// Victorian party bucketing — supplied by the consumer, not the engine.
// Mirrors examples/basic.ts: joint Coalition ticket → Liberal, per-seat
// independents → a single "ind" row.
export function vicFold(id: PartyId): PartyId {
  if (id === "coa") return "lib";
  if (id.startsWith("ind_")) return "ind";
  return id;
}

// Serializable form of vicFold for the Monte Carlo worker (a function can't
// cross the thread boundary — see FoldSpec in src/mc/messages.ts).
export const FOLD_SPEC = {
  exact: { coa: "lib" },
  prefix: [["ind_", "ind"]] as Array<[string, string]>,
};

// Formal-vote weight per demographic — fixed by the dataset, so compute once.
export const DEMO_STATS = computeDemoStats(DATA.la.seats);

// Resolved One Nation demographic model for a scenario. `resolvedOnpDemo` is
// the four displayed per-region shares; `*ForModel`/`laRakedPrimaries` are the
// arguments threaded into the LA projection (undefined when ONP is untouched,
// so the baseline path is unchanged). Raking holds every other party's
// statewide total flat while reshaping ONP by region; when the pins are too
// extreme to reconcile (`rakeFeasible === false`) we drop the raked primaries
// and fall back to per-seat redistribution.
export interface OnpModel {
  statewideOnpPct: number;
  resolvedOnpDemo: Record<Demographic, number>;
  resolvedOnpDemoForModel?: Record<Demographic, number>;
  laRakedPrimaries?: Map<string, Record<PartyId, number>>;
  rakeFeasible: boolean;
}

export function resolveOnpModel(scenario: ScenarioState): OnpModel {
  const agg = aggregateLaPrimaries(DATA.la.seats, scenario, {
    bucketIndies: false,
  });
  const total = Object.values(agg).reduce((a, b) => a + b, 0);
  const statewideOnpPct = total > 0 ? ((agg.onp ?? 0) / total) * 100 : 0;
  const resolvedOnpDemo = resolveOnpDemographic(
    statewideOnpPct,
    scenario.onpDemographic,
    DEMO_STATS,
  );
  const onpEngaged =
    "onp" in scenario.manualSwings ||
    Object.keys(scenario.onpDemographic).length > 0;
  const resolvedOnpDemoForModel = onpEngaged ? resolvedOnpDemo : undefined;
  const laRake = resolvedOnpDemoForModel
    ? rakeLaOnpDemographic(DATA.la.seats, scenario, resolvedOnpDemoForModel)
    : null;
  const laRakedPrimaries = laRake?.feasible ? laRake.primaries : undefined;
  return {
    statewideOnpPct,
    resolvedOnpDemo,
    resolvedOnpDemoForModel,
    laRakedPrimaries,
    rakeFeasible: laRake ? laRake.feasible : true,
  };
}

// Deterministic seat projections under a scenario, folded to Victorian rows.
export function projectLa(scenario: ScenarioState): Tally {
  const { resolvedOnpDemoForModel, laRakedPrimaries } =
    resolveOnpModel(scenario);
  return tallySeats(
    runAllLaIrv(
      DATA.la.seats,
      DATA.preferenceFlows,
      scenario,
      resolvedOnpDemoForModel,
      laRakedPrimaries,
    ),
    vicFold,
  );
}
export function projectLc(scenario: ScenarioState): Tally {
  return tallyLcSeats(runAllLcStv(DATA.lc.regions, scenario), vicFold);
}

// Statewide primary aggregates (lib+nat folded into a single Coalition row).
// The ONP demographic model reshapes ONP across regions, so feed it through
// here too — otherwise the votes chart and the seat projection would disagree.
export function laVotes(scenario?: ScenarioState): Tally {
  const model = scenario ? resolveOnpModel(scenario) : undefined;
  return aggregateLaPrimaries(DATA.la.seats, scenario, {
    groupCoalition: true,
    resolvedOnpDemo: model?.resolvedOnpDemoForModel,
    rakedPrimaries: model?.laRakedPrimaries,
  });
}
export function lcVotes(scenario?: ScenarioState): Tally {
  return aggregateLcPrimaries(DATA.lc.regions, scenario, {
    groupCoalition: true,
  });
}

// Fold a seat tally further for display: combine Liberal + Nationals into one
// "Coalition" row (the engine keeps them separate so they can be itemised).
export function foldCoalition(t: Tally): Tally {
  const out: Tally = {};
  for (const [k, v] of Object.entries(t)) {
    const dest = k === "lib" || k === "nat" || k === "coa" ? "coa" : k;
    out[dest] = (out[dest] ?? 0) + v;
  }
  return out;
}

export function party(id: PartyId): ResolvedParty {
  return resolveParty(id, DATA.parties);
}

// Left→right political-spectrum order for the composition strip. Covers every
// id in the dataset so minors land on the correct edge.
export const SPECTRUM_ORDER: PartyId[] = [
  "grn",
  "ajp",
  "lcn",
  "sap",
  "alp",
  "ind_teal",
  "ind",
  "oth",
  "dlp",
  "ind_country",
  "lib",
  "coa",
  "nat",
  "ldp",
  "onp",
];

// Compact display order for the votes/seats bar charts.
export const CHART_ORDER: PartyId[] = [
  "alp",
  "coa",
  "grn",
  "onp",
  "ind",
  "oth",
  "lcn",
  "ajp",
  "sap",
  "ldp",
  "dlp",
];

export function sumTally(t: Tally): number {
  return Object.values(t).reduce((a, b) => a + b, 0);
}

// Order a folded tally's present parties by SPECTRUM_ORDER (used by the
// composition strip).
export function spectrumKeys(t: Tally): PartyId[] {
  const present = new Set<PartyId>();
  for (const [k, n] of Object.entries(t)) if (n > 0) present.add(k);
  const ordered: PartyId[] = [];
  for (const id of SPECTRUM_ORDER) if (present.has(id)) ordered.push(id);
  for (const id of Array.from(present).sort())
    if (!SPECTRUM_ORDER.includes(id)) ordered.push(id);
  return ordered;
}
