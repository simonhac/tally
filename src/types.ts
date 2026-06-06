// Types for the Victorian seat-conversion model. See data/vic/vic-result-2022.yaml.

export type PartyId = string; // e.g. "alp", "lib", "nat", "grn", "oth", "ind_<seat>"

export type PartyKind = "major" | "minor" | "indie" | "bucket";

export interface Party {
  label: string;
  colour: string;
  kind: PartyKind;
}

export interface FlowRow {
  source: string;
  assumption: string;
  measured?: boolean; // per-seat overrides set this; statewide rows omit it
  flows: Record<PartyId, number>; // sums to ~1
}

export interface PreferenceFlows {
  matrix: Record<PartyId, FlowRow>;
}

export interface TwoCp {
  winner: PartyId;
  loser: PartyId;
  winnerPct: number; // e.g. 51.6
}

export type Demographic =
  | "Inner Metropolitan"
  | "Outer Metropolitan"
  | "Provincial"
  | "Rural";

export interface SeatBaseline {
  id: string;
  name: string;
  region: string;
  demographic?: Demographic;
  formal: number;
  primaries: Record<PartyId, number>; // votes, not percentages
  twoCp: TwoCp;
  placeholder?: boolean;
  calibration?: string;
  // Per-seat preference flow overrides. Each entry replaces the
  // statewide matrix row for that source party when IRV runs in this
  // seat. Used where a measured local DoP differs materially from the
  // statewide row (e.g. Greens flowing to a teal indie standing here).
  preferenceOverrides?: Partial<Record<PartyId, FlowRow>>;
}

export interface LcGroup {
  id: string; // ATL letter, e.g. "A"
  party: PartyId;
  label: string;
  primaries: number;
  // Observed split of `primaries` into above-the-line (follows GVT) and
  // below-the-line (own-candidate-numbering) buckets, from VEC per-polling-
  // place tallies. Sum to `primaries` modulo rounding.
  atl?: number;
  btl?: number;
  candidates?: number; // number of candidates fielded by this group
  // Registered GVTs (1-3 per group). The group's ATL pile is split equally
  // across all registered tickets; each ticket is an ordered list of group
  // ids representing the cumulative preference flow. Synthetic groups (e.g.
  // the ZZ informal bucket) omit this and do not take part in the count.
  tickets?: string[][];
}

export interface RegionBaseline {
  id: string;
  name: string;
  seats: number; // always 5 for VIC LC 2022
  formal: number;
  groups: LcGroup[];
  placeholder?: boolean;
}

export interface Assumption {
  id: string;
  summary: string;
  rationale: string;
  impact: string;
  confidence: "high" | "medium" | "low";
}

export interface Vic2022Data {
  meta: {
    source: string;
    sourceUrl: string;
    lastUpdated: string;
    flowMatrixSource: string;
    notes?: string;
  };
  parties: Record<PartyId, Party>;
  preferenceFlows: PreferenceFlows;
  la: { seats: SeatBaseline[] };
  lc: { regions: RegionBaseline[] };
  assumptions: Assumption[];
}

// A named scenario preset offered by the seats page. The button "2022
// Repeat" and the open-ended "Custom" mode aren't presets in this sense
// (no swings to pre-populate). `id` doubles as the `?mode=` URL value.
export interface ScenarioPreset {
  id: string;
  label: string;
  description?: string;
  // Per-party primary swings in percentage points (vs the 2022 baseline).
  swings: Record<PartyId, number>;
  // Optional pinned ONP regional shares. Demographics omitted here remain
  // automatic in the panel and absorb the gap to the statewide ONP target.
  onpDemographic?: Partial<Record<Demographic, number>>;
}

// Current Victorian Parliament composition, used as the headcount
// baseline for the AEF 2018 Act vs 2026 Act comparison table.
export interface CurrentCompositionParty {
  la: number;
  lc: number;
}

export interface CurrentCompositionIndie {
  chamber: "la" | "lc";
  formerParty: PartyId | null;
  note: string;
}

export interface CurrentComposition {
  asAt: string;
  source: string;
  parties: Record<PartyId, CurrentCompositionParty>;
  electedIndies: CurrentCompositionIndie[];
}

// Funding figures shown in the AssumptionsPanel "About" prose. Sourced
// from the vic-funding-cycle*.yaml files (electoralFunding + adminFunding.act2018) and
// threaded through the seats page so the prose never hardcodes rates that
// live in YAML.
export interface AboutFunding {
  cycle26PerVote: { lowerHouse: number; upperHouse: number };
  cycle30PerVote: { lowerHouse: number; upperHouse: number };
  aefFy23: { firstMember: number; secondMember: number; thirdToCap: number };
  capMembers: number;
  priorElectionThresholdPct: number;
}

// vic-projection-2026.yaml — cycle30 projection methodology + assumptions. Funding
// rates themselves live in vic-funding-cycle30.yaml; this file holds the few constants
// used to project 2022 → 2026 first-preference votes, the named
// scenario presets surfaced by the seats page, and the current
// parliament composition used for the AEF comparison.
export interface Vic2026Data {
  meta: {
    source: string;
    lastUpdated: string;
    methodology: string;
  };
  scaling: {
    growthFactor: number;
    lhFormal: number;
    uhFormal: number;
  };
  scenarioPresets: ScenarioPreset[];
  currentComposition: CurrentComposition;
  assumptions: Assumption[];
}

// --------------- Scenario state ---------------

export interface ScenarioState {
  // Per-party primary swing in percentage points (e.g. +2.5). Only parties
  // the user has pinned ("manual") appear here. Parties absent from the map
  // are "automatic": they absorb the redistribution required to keep totals
  // conserved, with the absorption split across them in proportion to their
  // existing share.
  manualSwings: Record<PartyId, number>;
  // Sparse overrides on the flow matrix. Shape:
  //   { srcPartyId: { destPartyId: fraction } }
  // Any present row replaces the entire baseline row.
  flowOverrides: Record<PartyId, Record<PartyId, number>>;
  // One Nation primary share (percent, 0..50) per demographic. Only the
  // demographics the user has pinned appear here; automatic demographics
  // are sized to keep the formal-vote-weighted average equal to the
  // statewide ON share implied by `manualSwings.onp`.
  onpDemographic: Partial<Record<Demographic, number>>;
}

// --------------- Algorithm outputs ---------------

export interface IrvRound {
  index: number;
  tallies: Record<PartyId, number>;
  eliminated?: PartyId;
  transfers?: Record<PartyId, number>; // votes added to each surviving party
}

export interface IrvResult {
  seatId: string;
  winner: PartyId;
  runnerUp: PartyId;
  finalPct: number; // winner's share of final two-candidate pool
  rounds: IrvRound[];
  baselineWinner: PartyId;
  changedFromBaseline: boolean;
}

export type StvStepKind =
  | "elect-on-quota"
  | "transfer-surplus"
  | "eliminate"
  | "transfer-eliminated";

export interface StvStep {
  index: number;
  kind: StvStepKind;
  groupId: string;
  note: string;
  tallies: Record<string, number>; // groupId → votes
}

export interface StvResult {
  regionId: string;
  quota: number;
  elected: { groupId: string; party: PartyId; roundIndex: number }[];
  steps: StvStep[];
}

// --------------- Summary helpers ---------------

export interface SeatTally {
  byParty: Record<PartyId, number>;
  total: number;
  majorityThreshold: number;
}
