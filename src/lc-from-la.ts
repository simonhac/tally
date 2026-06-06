// Seed the Legislative Council projection from the Legislative Assembly one.
//
// The /victoria/one-nation story assumes the polling (a lower-house voting
// intention) is replicated in the upper house: One Nation's — and every other
// party's — projected SHARE in the Council equals its projected share in the
// Assembly. The base seat/vote engine is a uniform-*swing* model, so applying
// the Assembly swings to the Council's own (very different) 2022 baseline lands
// on different shares per house; the two would not average to the poll. Instead
// we reshape each Council region's group primaries so the region's per-party
// shares match the Assembly projection for the same geography, then run the
// EXISTING STV count / aggregation on the reshaped regions with an empty
// scenario (no further swing).
//
// Crucially this preserves the Assembly's demographic skew and IPF raking: the
// per-region target is built from the already-raked, demographic-shaped
// per-seat Assembly projection of the 11 Assembly districts inside each Council
// region (every LA seat carries its parent LC `region` id). Rural Council
// regions inherit rural-strong One Nation; metro regions inherit weak One
// Nation. Nothing about the Assembly raking path changes.
//
// Pure / server-safe: no React, no DOM.

import type { LcGroup, PartyId, RegionBaseline, SeatBaseline } from "./types";

// Mirrors MAJOR_DISPLAY in one-nation.ts: the parties that get their own chart
// row; everything else folds into "oth". `nat` is a major on the Assembly side
// but never appears as a Council group (the Coalition contests the Council on a
// single LNP/`lib` regional ticket), so it is folded into `lib` for the target.
const MAJOR = new Set<PartyId>(["alp", "lib", "nat", "grn", "onp"]);

function displayBucket(party: PartyId): PartyId {
  return MAJOR.has(party) ? party : "oth";
}

function sum(rec: Record<string, number>): number {
  return Object.values(rec).reduce((a, b) => a + b, 0);
}

// Per Council region (by id), the target party-share vector over the display
// buckets {alp, lib, grn, onp, oth} (nat folded into lib), summing to 1 — the
// formal-vote share each party should hold in that region under the projection.
// Built by aggregating the projected (raked) primaries of the Assembly seats
// whose `region` equals the Council region id.
export function laRegionTargets(
  seats: SeatBaseline[],
  laProj: (seat: SeatBaseline) => Record<PartyId, number>,
): Map<string, Record<PartyId, number>> {
  const totals = new Map<string, Record<PartyId, number>>();
  for (const seat of seats) {
    const proj = laProj(seat);
    const acc = totals.get(seat.region) ?? {};
    for (const [party, votes] of Object.entries(proj)) {
      const b = displayBucket(party);
      acc[b] = (acc[b] ?? 0) + votes;
    }
    totals.set(seat.region, acc);
  }

  const targets = new Map<string, Record<PartyId, number>>();
  for (const [regionId, acc] of totals) {
    // Fold nat into lib, then normalise to shares.
    const merged: Record<PartyId, number> = { ...acc };
    if (merged.nat) {
      merged.lib = (merged.lib ?? 0) + merged.nat;
      delete merged.nat;
    }
    const total = sum(merged);
    const shares: Record<PartyId, number> = {};
    for (const [party, votes] of Object.entries(merged)) {
      shares[party] = total > 0 ? votes / total : 0;
    }
    targets.set(regionId, shares);
  }
  return targets;
}

// Rewrite one region's group primaries so the region's per-display-bucket
// shares equal `target` (× the region's own `formal`), preserving the group /
// ticket structure, the ATL/BTL split ratio, and the ZZ informal group. Groups
// of the same display bucket (notably the many minor-party "oth" groups) split
// their bucket total in proportion to their 2022 primaries — so Council-only
// micro-parties keep a realistic slice and no group is invented.
export function reshapeRegionFromTargets(
  region: RegionBaseline,
  target: Record<PartyId, number>,
): RegionBaseline {
  const formal = region.formal;
  if (!(formal > 0)) return region;

  const byBucket = new Map<PartyId, LcGroup[]>();
  let zz: LcGroup | undefined;
  for (const g of region.groups) {
    if (g.id === "ZZ") {
      zz = g;
      continue;
    }
    const b = displayBucket(g.party);
    const list = byBucket.get(b);
    if (list) list.push(g);
    else byBucket.set(b, [g]);
  }

  // Each major bucket present takes its target share; "oth" absorbs the rest
  // (including the mass of any major with no group in this region, so the
  // region still sums to `formal`).
  let majorShareWithGroups = 0;
  for (const b of ["alp", "lib", "grn", "onp"]) {
    if (byBucket.has(b)) majorShareWithGroups += target[b] ?? 0;
  }
  const othShare = Math.max(0, 1 - majorShareWithGroups);

  const out: LcGroup[] = [];
  for (const [bucket, groups] of byBucket) {
    const share = bucket === "oth" ? othShare : target[bucket] ?? 0;
    const bucketTotal = share * formal;
    const base = groups.reduce((s, g) => s + g.primaries, 0);
    for (const g of groups) {
      const w = base > 0 ? g.primaries / base : 1 / groups.length;
      const primaries = bucketTotal * w;
      const ng: LcGroup = { ...g, primaries };
      if (g.atl != null && g.btl != null && g.primaries > 0) {
        const atlFrac = g.atl / g.primaries;
        ng.atl = primaries * atlFrac;
        ng.btl = primaries * (1 - atlFrac);
      }
      out.push(ng);
    }
  }
  if (zz) out.push(zz);
  return { ...region, groups: out };
}

// Reshape all Council regions to replicate the Assembly projection geography.
export function reshapeLcRegionsFromLa(
  regions: RegionBaseline[],
  seats: SeatBaseline[],
  laProj: (seat: SeatBaseline) => Record<PartyId, number>,
): RegionBaseline[] {
  const targets = laRegionTargets(seats, laProj);
  return regions.map((region) => {
    const target = targets.get(region.id);
    return target ? reshapeRegionFromTargets(region, target) : region;
  });
}
