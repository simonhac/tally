// Single-region proportional (Droop-quota STV) seat allocation with preference
// transfers, run at the PARTY-BUCKET level. Extracted from the federal Senate
// model (lib/seats/fed-one-nation.ts) so the NSW Legislative Council projection
// — a single statewide 21-seat STV contest — reuses the same proven count.
//
// This replaces the GVT-ticket STV (lib/seats/stv.ts) for party-bucket models:
// with only a handful of party buckets but many seats, that engine's "elect all
// remaining standing groups" fallback fires immediately and never fills the
// chamber. Here a Droop quota is taken seat-by-seat, surpluses/eliminations
// transfer by the same preference-flow matrix the House/Assembly IRV uses (so a
// minor party can take a final seat on major-party preferences), and per-party
// seat `caps` bound parties that rarely field enough candidates to win more.
//
// `caps` is a parameter (the federal model caps Greens/One Nation at 2 in a
// half-Senate state; NSW's 21-seat LC allows a much larger One Nation count).
// Pass {} for an uncapped count.

import type { PartyId, PreferenceFlows } from "./types";

export function allocateProportionalRegion(
  shares: Record<PartyId, number>,
  seats: number,
  flows: PreferenceFlows,
  caps: Record<PartyId, number> = {},
): Record<PartyId, number> {
  const quota = 1 / (seats + 1); // Droop, as a fraction of the formal vote
  const votes: Record<PartyId, number> = { ...shares };
  const won: Record<PartyId, number> = {};
  const eliminated = new Set<PartyId>();
  const capped = new Set<PartyId>();
  const active = (p: PartyId) =>
    !eliminated.has(p) && !capped.has(p) && (votes[p] ?? 0) > 1e-9;

  const transferFrom = (from: PartyId) => {
    const amt = votes[from] ?? 0;
    votes[from] = 0;
    if (amt <= 0) return;
    const row = flows.matrix[from]?.flows ?? {};
    const dests = Object.keys(row).filter((d) => d !== from && active(d));
    const wsum = dests.reduce((s, d) => s + row[d], 0);
    if (wsum > 0) {
      for (const d of dests) votes[d] = (votes[d] ?? 0) + amt * (row[d] / wsum);
    } else {
      const others = Object.keys(votes).filter((d) => d !== from && active(d));
      for (const d of others) votes[d] = (votes[d] ?? 0) + amt / others.length;
    }
  };

  let filled = 0;
  let guard = 0;
  while (filled < seats && guard++ < 200) {
    const standing = Object.keys(votes).filter(active);
    if (standing.length === 0) break;
    standing.sort((a, b) => votes[b] - votes[a]);
    const top = standing[0];
    if (votes[top] >= quota - 1e-12) {
      won[top] = (won[top] ?? 0) + 1;
      filled++;
      votes[top] -= quota;
      const cap = caps[top];
      if (cap != null && (won[top] ?? 0) >= cap) {
        capped.add(top);
        transferFrom(top); // leftover preferences flow on
      }
    } else if (standing.length <= seats - filled) {
      // No one at quota and few enough parties left — fill the remaining seats
      // by largest remainder (the standing list is already sorted desc).
      for (const p of standing) {
        if (filled >= seats) break;
        won[p] = (won[p] ?? 0) + 1;
        filled++;
      }
      break;
    } else {
      // Eliminate the lowest and transfer its votes by preferences.
      const low = standing[standing.length - 1];
      eliminated.add(low);
      transferFrom(low);
    }
  }
  return won;
}
