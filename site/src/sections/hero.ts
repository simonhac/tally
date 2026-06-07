// Masthead hero: dataset framing + the two baseline composition strips
// (Assembly & Council) showing the deterministic 2022 projection.

import { emptyScenario } from "@tally";
import { compositionBar } from "../charts";
import { clear, h } from "../dom";
import {
  DATA,
  foldCoalition,
  LA_MAJORITY,
  LA_TOTAL,
  LC_MAJORITY,
  LC_TOTAL,
  party,
  projectLa,
  projectLc,
  spectrumKeys,
} from "../engine";

function chamberCard(
  label: string,
  total: number,
  majority: number,
  tally: Record<string, number>,
): HTMLElement {
  const keys = spectrumKeys(tally);
  const legend = h(
    "div.legend",
    {},
    ...keys.map((id) => {
      const p = party(id);
      return h(
        "span.legend-item",
        {},
        h("span.legend-dot", { style: { background: p.color } }),
        h("span.legend-name", {}, p.name),
        h("span.legend-n mono", {}, String(tally[id] ?? 0)),
      );
    }),
  );
  return h(
    "div.chamber-card",
    {},
    h(
      "div.chamber-head",
      {},
      h("h3", {}, label),
      h("span.chamber-total mono", {}, `${total} seats · ${majority} for majority`),
    ),
    compositionBar(keys, tally, total, majority),
    legend,
  );
}

export function renderHero(root: HTMLElement) {
  const base = emptyScenario();
  const la = foldCoalition(projectLa(base));
  const lc = foldCoalition(projectLc(base));

  clear(root).append(
    h("p.kicker", {}, "Open-source election engine · live demo"),
    h("h1.hero-title", {}, "Victoria 2022, recounted in your browser"),
    h(
      "p.hero-lead",
      {},
      "Every primary vote and preference flow from the 2022 Victorian state " +
        "election, fed through the ",
      h("strong", {}, "open tally room"),
      " engine. Dial a swing below and watch all 88 lower-house seats and 40 " +
        "upper-house seats re-count in real time — instant-runoff and " +
        "single-transferable-vote, exactly as the VEC ran them.",
    ),
    h(
      "div.chambers",
      {},
      chamberCard("Legislative Assembly", LA_TOTAL, LA_MAJORITY, la),
      chamberCard("Legislative Council", LC_TOTAL, LC_MAJORITY, lc),
    ),
    h(
      "p.source-line",
      {},
      "Source: ",
      h("a", { href: DATA.meta.sourceUrl, target: "_blank", rel: "noopener" }, DATA.meta.source),
      ` · last updated ${DATA.meta.lastUpdated}`,
    ),
  );
}
