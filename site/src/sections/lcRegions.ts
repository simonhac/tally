// Legislative Council — 8 regions, 5 members each, elected by single
// transferable vote (Weighted Inclusive Gregory with group voting tickets).
// Shows the projected 5 winners per region and an expandable group breakdown
// (primary share + above/below-the-line split). Static baseline.

import { emptyScenario, runAllLcStv } from "@tally";
import type { LcGroup, RegionBaseline } from "@tally";
import { clear, fmtInt, fmtPct1, h } from "../dom";
import { DATA, party } from "../engine";

const RESULTS = runAllLcStv(DATA.lc.regions, emptyScenario());

function electedChips(region: RegionBaseline): HTMLElement {
  const result = RESULTS[region.id];
  const byId = new Map(region.groups.map((g) => [g.id, g] as const));
  const chips = (result?.elected ?? []).map((e) => {
    const g = byId.get(e.groupId);
    const p = party(e.party);
    return h(
      "span.lc-chip",
      { style: { borderColor: p.color }, title: g?.label ?? e.groupId },
      h("span.lc-chip-dot", { style: { background: p.color } }),
      g?.label ?? e.groupId,
    );
  });
  return h("div.lc-elected", {}, ...chips);
}

function groupRow(group: LcGroup, formal: number): HTMLElement | null {
  if (group.id === "ZZ") return null; // informal bucket — not in the count
  const p = party(group.party);
  const pct = (group.primaries / formal) * 100;
  const atlPct = group.atl != null ? (group.atl / group.primaries) * 100 : null;
  return h(
    "div.lc-group",
    {},
    h("span.lc-g-dot", { style: { background: p.color } }),
    h(
      "span.lc-g-label",
      {},
      h("span.lc-g-letter mono", {}, group.id),
      group.label,
    ),
    h(
      "span.lc-g-bar",
      {},
      h("span.lc-g-fill", {
        style: { width: `${Math.min(100, pct)}%`, background: p.color },
      }),
    ),
    h("span.lc-g-pct mono", {}, fmtPct1(pct)),
    h(
      "span.lc-g-split mono muted",
      { title: "Above / below the line" },
      atlPct != null ? `${atlPct.toFixed(0)}% ATL` : "",
    ),
  );
}

function regionCard(region: RegionBaseline): HTMLElement {
  const groups = [...region.groups]
    .filter((g) => g.id !== "ZZ")
    .sort((a, b) => b.primaries - a.primaries);
  const list = h(
    "div.lc-groups",
    {},
    ...groups.map((g) => groupRow(g, region.formal)).filter(Boolean) as Node[],
  );
  list.style.display = "none";

  const moreBtn = h(
    "button.lc-more",
    { type: "button" },
    `All ${groups.length} groups`,
  );
  moreBtn.addEventListener("click", () => {
    const open = list.style.display !== "none";
    list.style.display = open ? "none" : "";
    moreBtn.textContent = open ? `All ${groups.length} groups` : "Hide groups";
  });

  return h(
    "div.lc-region",
    {},
    h(
      "div.lc-region-head",
      {},
      h("h3", {}, region.name),
      h("span.muted mono", {}, `${fmtInt(region.formal)} formal · ${region.seats} seats`),
    ),
    electedChips(region),
    moreBtn,
    list,
  );
}

export function renderLcRegions(root: HTMLElement) {
  clear(root).append(
    h("h2.section-title", {}, "The upper house"),
    h(
      "p.section-sub",
      {},
      "Eight regions each return five members by single transferable vote. " +
        "Projected winners shown; expand a region for the full field and the " +
        "above-the-line share.",
    ),
    h("div.lc-grid", {}, ...DATA.lc.regions.map(regionCard)),
  );
}
