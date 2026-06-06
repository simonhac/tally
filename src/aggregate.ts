import { applySwing, applySwingForSeat } from "./scenario";
import type {
  Demographic,
  PartyId,
  RegionBaseline,
  ScenarioState,
  SeatBaseline,
} from "./types";

// Map raw primary keys to the display buckets used in charts/tallies.
// coa → lib (joint-LNP ticket folded into Liberal) by default; with
// `groupCoalition` true, both lib and nat fold into coa so the chart
// shows a single Coalition row. ind_<anything> → ind when bucketIndies
// is true; with bucketIndies false, ind_country and ind_teal pass
// through as themselves (the funding table shows them as separate rows).
export function bucketParty(
  id: PartyId,
  opts: { bucketIndies?: boolean; groupCoalition?: boolean } = {},
): PartyId {
  const { bucketIndies = true, groupCoalition = false } = opts;
  if (groupCoalition && (id === "lib" || id === "nat" || id === "coa"))
    return "coa";
  if (id === "coa") return "lib";
  if (bucketIndies && id.startsWith("ind_")) return "ind";
  return id;
}

export interface AggregateOptions {
  bucketIndies?: boolean;
  // Fold lib + nat into a single `coa` row.
  groupCoalition?: boolean;
  // When supplied, ON's per-seat share is set to this value for each
  // seat's demographic (instead of receiving the uniform `manualSwings.onp`
  // swing). Seats without a `demographic` keep the uniform behaviour.
  resolvedOnpDemo?: Record<Demographic, number>;
  // Raked per-seat primaries (seatId → primaries) from
  // `rakeLaOnpDemographic`. When present, a seat's raked row is summed
  // directly instead of recomputing the per-seat swing — so the funding
  // aggregate and the seat count share one source of truth.
  rakedPrimaries?: Map<string, Record<PartyId, number>>;
}

export function aggregateLaPrimaries(
  seats: SeatBaseline[],
  scenario?: ScenarioState,
  opts: AggregateOptions = {},
): Record<PartyId, number> {
  const out: Record<PartyId, number> = {};
  for (const seat of seats) {
    const prim =
      opts.rakedPrimaries?.get(seat.id) ??
      (scenario
        ? applySwingForSeat(seat, scenario.manualSwings, opts.resolvedOnpDemo)
        : seat.primaries);
    for (const [k, v] of Object.entries(prim)) {
      const key = bucketParty(k, opts);
      out[key] = (out[key] ?? 0) + v;
    }
  }
  return out;
}

// Mirrors runLcStv: each group's swing is its party's swing, applied
// region-by-region so applySwing renormalises within each region.
export function aggregateLcPrimaries(
  regions: RegionBaseline[],
  scenario?: ScenarioState,
  opts: AggregateOptions = {},
): Record<PartyId, number> {
  const out: Record<PartyId, number> = {};
  for (const region of regions) {
    const primariesByGroupId: Record<string, number> = {};
    const partyByGroupId: Record<string, PartyId> = {};
    for (const g of region.groups) {
      // Skip the ZZ informal bucket: the VEC reports vote shares against the
      // formal vote, so informal must not enter the denominator (nor be folded
      // into the "oth" bar). Mirrors stv.ts, which drops ZZ from the count.
      if (g.id === "ZZ") continue;
      primariesByGroupId[g.id] = g.primaries;
      partyByGroupId[g.id] = g.party;
    }
    let post = primariesByGroupId;
    if (scenario) {
      // A group inherits its party's manual/auto state — pin only the
      // groups whose party the user has dialled.
      const manualSwingsByGroupId: Record<string, number> = {};
      for (const g of region.groups) {
        if (g.party in scenario.manualSwings) {
          manualSwingsByGroupId[g.id] = scenario.manualSwings[g.party];
        }
      }
      post = applySwing(primariesByGroupId, manualSwingsByGroupId);
    }
    for (const [gid, v] of Object.entries(post)) {
      const key = bucketParty(partyByGroupId[gid], opts);
      out[key] = (out[key] ?? 0) + v;
    }
  }
  return out;
}
