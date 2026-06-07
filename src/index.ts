// tally — framework-agnostic Australian election simulation engine.
//
// Public API surface. Import from "@tally" in the app. This barrel deliberately
// does NOT export the Monte Carlo worker module (tally/src/mc/
// montecarlo.worker.ts) — workers are loaded by URL via the "@tally/*" deep
// path, not imported as values.

// --- core types ---
export type {
  PartyId,
  PartyKind,
  Party,
  FlowRow,
  PreferenceFlows,
  TwoCp,
  Demographic,
  SeatBaseline,
  LcGroup,
  RegionBaseline,
  Assumption,
  Vic2022Data,
  ScenarioPreset,
  CurrentCompositionParty,
  CurrentCompositionIndie,
  CurrentComposition,
  AboutFunding,
  Vic2026Data,
  ScenarioState,
  IrvRound,
  IrvResult,
  StvStepKind,
  StvStep,
  StvResult,
  SeatTally,
} from "./types";

// --- scenario (swings, demographic resolution, reducer) ---
export {
  DEMOGRAPHICS,
  ONP_DEMO_MIN,
  ONP_DEMO_MAX,
  emptyScenario,
  applySwing,
  autoSwingDisplay,
  computeDemoStats,
  resolveOnpDemographic,
  applySwingForSeat,
  mergeFlowOverrides,
  scenarioReducer,
} from "./scenario";
export type { DemoStats, ScenarioAction } from "./scenario";

// --- electoral math ---
export { runLaIrv, runAllLaIrv, tallySeats } from "./irv";
export { runLcStv, runAllLcStv, tallyLcSeats } from "./stv";
export { rakeLaOnpDemographic } from "./raking";
export type { RakeResult } from "./raking";
export { bucketParty, aggregateLaPrimaries, aggregateLcPrimaries } from "./aggregate";
export type { AggregateOptions } from "./aggregate";
export { allocateProportionalRegion } from "./proportional-allocate";
export {
  laRegionTargets,
  reshapeRegionFromTargets,
  reshapeLcRegionsFromLa,
} from "./lc-from-la";

// --- url (scenario <-> query serialization) ---
export {
  resolveActorParam,
  SEATS_URL_DEFAULTS,
  seatsStateToQuery,
  seatsStateFromQuery,
} from "./url";
export type { SeatsView, PresetMode, SeatsUrlState } from "./url";

// --- display ---
export { BUCKET_LABEL, resolveParty } from "./party-display";
export type { ResolvedParty } from "./party-display";

// --- monte carlo (React-free) ---
export { mulberry32, gaussian } from "./mc/prng";
export { buildMultinomialCholesky } from "./mc/cholesky";
export { computeQuantiles } from "./mc/quantiles";
export type { QuantileStats } from "./mc/quantiles";
export type {
  NoiseConfig,
  FoldSpec,
  BenchRunMessage,
  BenchProgressMessage,
  BenchInterimMessage,
  BenchUpdateDeadlineMessage,
  BenchInMessage,
  BenchDoneMessage,
  BenchOutMessage,
} from "./mc/messages";
