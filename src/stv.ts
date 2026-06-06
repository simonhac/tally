import type {
  LcGroup,
  PartyId,
  RegionBaseline,
  ScenarioState,
  StvResult,
  StvStep,
} from "./types";
import { applySwing } from "./scenario";

// Preference rank for synthetic teal / country-indie groups injected into
// the LC when the corresponding swing slider is dialled. Teals and country
// indies didn't register ATL groups in 2022, so without this they can't win
// LC seats no matter how high the swing. The ticket is constructed by
// sorting the region's real groups by these party ranks. Mirrors the
// LA-level ind_teal / ind_country flow rows in data/vic/vic-result-2022.yaml.
const TEAL_AFFINITY: PartyId[] = [
  "ind_teal",
  "grn",
  "ajp",
  "alp",
  "sap",
  "lcn",
  "oth",
  "dlp",
  "ldp",
  "lib",
  "nat",
  "coa",
  "onp",
];
const COUNTRY_AFFINITY: PartyId[] = [
  "ind_country",
  "lcn",
  "dlp",
  "alp",
  "oth",
  "grn",
  "lib",
  "nat",
  "coa",
  "ajp",
  "sap",
  "ldp",
  "onp",
];
function buildSyntheticGroups(
  region: RegionBaseline,
  scenario: ScenarioState,
): LcGroup[] {
  const synthetic: LcGroup[] = [];
  const specs: { party: PartyId; id: string; label: string; affinity: PartyId[] }[] = [
    { party: "ind_teal", id: "ZT", label: "Teal indie", affinity: TEAL_AFFINITY },
    { party: "ind_country", id: "ZC", label: "Country indie", affinity: COUNTRY_AFFINITY },
  ];
  for (const spec of specs) {
    if (!(spec.party in scenario.manualSwings)) continue;
    if (region.groups.some((g) => g.party === spec.party)) continue;
    const rank = new Map<PartyId, number>();
    spec.affinity.forEach((p, i) => rank.set(p, i));
    const sortedReal = region.groups
      .filter((g) => g.tickets && g.tickets.length > 0)
      .map((g, idx) => ({ g, idx }))
      .sort((a, b) => {
        const ra = rank.get(a.g.party) ?? spec.affinity.length;
        const rb = rank.get(b.g.party) ?? spec.affinity.length;
        if (ra !== rb) return ra - rb;
        return a.idx - b.idx;
      })
      .map(({ g }) => g.id);
    const ticket = [spec.id, ...sortedReal];
    synthetic.push({
      id: spec.id,
      party: spec.party,
      label: spec.label,
      primaries: 0,
      atl: 0,
      btl: 0,
      candidates: 1,
      tickets: [ticket],
    });
  }
  return synthetic;
}

// Weighted Inclusive Gregory STV with Victorian Group Voting Tickets +
// BTL split — the same surplus-transfer arithmetic VEC uses for the LC.
//
// Each group's ATL pile is split equally across its registered tickets
// (1-3 tickets in Vic 2022). A "bundle" is one ticket's share of a
// group's pile; each bundle follows its OWN ticket through the count,
// independently of other bundles from the same group. Each group's BTL
// pile rides as a separate bundle whose ticket has only the origin
// group, so the BTL share helps fill the group's own candidate slots
// then exhausts (modelling BTL voters who number their own party and
// stop).
//
// Bundle anatomy:
//   - originGroup / ticketIdx — provenance, for debugging
//   - ticket — ordered list of group ids
//   - amount — current votes (drops when contributing to an election)
//   - headIdx — index into ticket; the group this bundle is currently
//                "with" is ticket[headIdx]. Bundles only advance their
//                head when the current head-group is fully elected
//                (cap reached) or eliminated.
//
// Each round:
//   1. groupTally[g] = sum of bundle.amount over bundles whose head = g.
//   2. If any standing group's tally >= quota, elect one candidate from
//      the highest-tally group. Set transfer value TV = (tally - quota)
//      / tally and multiply every contributing bundle's amount by TV.
//      Because each bundle's amount already embeds any prior TVs, the
//      multiplication compounds — i.e. this is Weighted Inclusive
//      Gregory, not single-pass. If the group hits its candidate cap,
//      mark "elected" and advance all its head-bundles to the next
//      standing group on each bundle's own ticket.
//   3. Otherwise, eliminate the lowest standing group; advance every
//      head-bundle past it (no further TV reduction on exclusion —
//      bundles carry their current weight forward).
//   4. Stop when seats elected or no standing groups remain.
//
// If a bundle's ticket has no remaining standing group, the bundle
// exhausts and its remaining amount is lost.

type Bundle = {
  originGroup: string;
  ticketIdx: number;
  ticket: string[];
  amount: number;
  headIdx: number; // -1 once exhausted
};

export function runLcStv(
  region: RegionBaseline,
  scenario: ScenarioState,
): StvResult {
  // Augment the region's real groups with synthetic ones for parties that
  // didn't register ATL groups in 2022 (teal, country indie) but for which
  // the user has dialled a swing. Without this, those sliders are inert
  // on the LC because no group's `party` matches.
  const groups: LcGroup[] = [
    ...region.groups,
    ...buildSyntheticGroups(region, scenario),
  ];

  // Apply per-party swing to each group's primary. A group inherits its
  // party's manual/auto state.
  const swingedByGroup = applySwing(
    groups.reduce<Record<string, number>>((acc, g) => {
      acc[g.id] = g.primaries;
      return acc;
    }, {}),
    groups.reduce<Record<string, number>>((acc, g) => {
      if (g.party in scenario.manualSwings) {
        acc[g.id] = scenario.manualSwings[g.party];
      }
      return acc;
    }, {}),
  );

  const partyByGroup: Record<string, PartyId> = {};
  const candidatesByGroup: Record<string, number> = {};
  for (const g of groups) {
    partyByGroup[g.id] = g.party;
    candidatesByGroup[g.id] = g.candidates ?? 1;
  }

  // Build initial bundles. For each group with registered tickets we
  // create K ATL bundles (one per ticket, carrying atl/K each) plus a
  // single BTL bundle whose "ticket" is just [originGroup] — meaning the
  // BTL pile participates in filling the group's own candidate slots
  // (via the cap mechanism) but exhausts once the group is fully
  // elected or eliminated, modelling BTL voters who number their own
  // party's candidates and stop.
  //
  // The swing is applied to the GROUP's total; we then split that swung
  // total into ATL/BTL using each group's recorded share. Groups missing
  // an ATL/BTL split fall back to "all ATL".
  const bundles: Bundle[] = [];
  for (const g of groups) {
    const tickets = g.tickets ?? [];
    const K = tickets.length;
    if (K === 0) continue; // ZZ etc.
    const swungTotal = swingedByGroup[g.id] ?? 0;
    // Synthetic groups have primaries=0; force 100% ATL rather than
    // dividing by `rawTotal = g.primaries || 1` which would give garbage
    // shares once the swing pushes swungTotal above zero.
    const synthetic = g.primaries === 0;
    const rawTotal = g.primaries || 1;
    const atlShare = synthetic ? 1 : g.atl != null ? g.atl / rawTotal : 1;
    const btlShare = synthetic ? 0 : g.btl != null ? g.btl / rawTotal : 0;
    const atlVotes = swungTotal * atlShare;
    const btlVotes = swungTotal * btlShare;
    const atlSlice = atlVotes / K;
    for (let i = 0; i < K; i++) {
      bundles.push({
        originGroup: g.id,
        ticketIdx: i,
        ticket: tickets[i],
        amount: atlSlice,
        headIdx: 0,
      });
    }
    if (btlVotes > 0) {
      bundles.push({
        originGroup: g.id,
        ticketIdx: -1, // -1 marks the BTL bundle
        ticket: [g.id],
        amount: btlVotes,
        headIdx: 0,
      });
    }
  }

  const seats = region.seats;
  const total = bundles.reduce((a, b) => a + b.amount, 0);
  const quota = Math.floor(total / (seats + 1)) + 1;

  type Status = "standing" | "elected" | "eliminated";
  const status: Record<string, Status> = {};
  for (const g of groups) status[g.id] = "standing";

  const electedFromGroup: Record<string, number> = {};
  for (const g of groups) electedFromGroup[g.id] = 0;

  const elected: StvResult["elected"] = [];
  const steps: StvStep[] = [];
  let stepIdx = 0;

  // Compute current group tallies from bundles.
  const computeTallies = (): Record<string, number> => {
    const t: Record<string, number> = {};
    for (const g of groups) t[g.id] = 0;
    for (const b of bundles) {
      if (b.headIdx < 0 || b.amount <= 0) continue;
      const head = b.ticket[b.headIdx];
      if (status[head] !== "standing") continue;
      t[head] = (t[head] ?? 0) + b.amount;
    }
    return t;
  };

  const snapshotTallies = (t: Record<string, number>) => ({ ...t });

  // Advance a bundle's head past any non-standing groups, to the next
  // standing group on its ticket. Sets headIdx = -1 if exhausted.
  const advance = (b: Bundle) => {
    for (let i = b.headIdx + 1; i < b.ticket.length; i++) {
      if (status[b.ticket[i]] === "standing") {
        b.headIdx = i;
        return;
      }
    }
    b.headIdx = -1;
  };

  let safety = 0;
  while (elected.length < seats && safety++ < 500) {
    const tallies = computeTallies();
    const standing = Object.entries(tallies)
      .filter(([id]) => status[id] === "standing")
      .sort((a, b) => b[1] - a[1]);

    if (standing.length === 0) break;

    const [topId, topTally] = standing[0];

    if (topTally >= quota) {
      // Elect one candidate from topId. Scale all contributing bundles'
      // amounts by (tally - quota) / tally to consume exactly one quota.
      electedFromGroup[topId]++;
      const cap = candidatesByGroup[topId];
      const scale = (topTally - quota) / topTally;
      for (const b of bundles) {
        if (b.headIdx < 0) continue;
        if (b.ticket[b.headIdx] === topId) b.amount *= scale;
      }
      elected.push({
        groupId: topId,
        party: partyByGroup[topId],
        roundIndex: stepIdx,
      });
      steps.push({
        index: stepIdx++,
        kind: "elect-on-quota",
        groupId: topId,
        note: `Elected on quota (${quota.toLocaleString()}); ${Math.round(topTally - quota).toLocaleString()} retained for next candidate`,
        tallies: snapshotTallies(tallies),
      });
      // If the group has now elected its full candidate slate, retire
      // it and advance all its head-bundles down their own tickets.
      if (electedFromGroup[topId] >= cap) {
        status[topId] = "elected";
        for (const b of bundles) {
          if (b.headIdx < 0) continue;
          if (b.ticket[b.headIdx] === topId) advance(b);
        }
      }
      continue;
    }

    // No group at quota. If the count of standing groups can't exceed
    // remaining seats, elect everyone left.
    if (standing.length + elected.length <= seats) {
      for (const [id] of standing) {
        if (elected.length >= seats) break;
        status[id] = "elected";
        elected.push({
          groupId: id,
          party: partyByGroup[id],
          roundIndex: stepIdx,
        });
        steps.push({
          index: stepIdx++,
          kind: "elect-on-quota",
          groupId: id,
          note: "Elected as last standing group(s)",
          tallies: snapshotTallies(tallies),
        });
      }
      break;
    }

    // Eliminate the lowest standing group; advance head-bundles.
    const [lowestId, lowestTally] = standing[standing.length - 1];
    status[lowestId] = "eliminated";
    for (const b of bundles) {
      if (b.headIdx < 0) continue;
      if (b.ticket[b.headIdx] === lowestId) advance(b);
    }
    steps.push({
      index: stepIdx++,
      kind: "eliminate",
      groupId: lowestId,
      note: `Eliminated (${Math.round(lowestTally).toLocaleString()} votes redistributed per ticket)`,
      tallies: snapshotTallies(tallies),
    });
  }

  return { regionId: region.id, quota, elected, steps };
}

export function runAllLcStv(
  regions: RegionBaseline[],
  scenario: ScenarioState,
): Record<string, StvResult> {
  const out: Record<string, StvResult> = {};
  for (const region of regions) {
    out[region.id] = runLcStv(region, scenario);
  }
  return out;
}

// Reduce per-region STV results to a per-party seat tally. Elected groups are
// counted under their RAW party id by default; pass a `fold` to bucket ids (the
// Victorian model folds coa→lib and ind_*→ind — see lib/seats/party-fold.ts).
export function tallyLcSeats(
  results: Record<string, StvResult>,
  fold: (id: PartyId) => PartyId = (id) => id,
): Record<PartyId, number> {
  const tally: Record<PartyId, number> = {};
  for (const r of Object.values(results)) {
    for (const e of r.elected) {
      const key = fold(e.party);
      tally[key] = (tally[key] ?? 0) + 1;
    }
  }
  return tally;
}
