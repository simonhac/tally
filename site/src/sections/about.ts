// About: the party legend (grouped by kind) and the dataset's documented
// modelling assumptions with confidence levels.

import { clear, h } from "../dom";
import { DATA, party } from "../engine";

const KIND_LABEL: Record<string, string> = {
  major: "Major parties",
  minor: "Minor parties",
  indie: "Independents",
  bucket: "Aggregates",
};

export function renderAbout(root: HTMLElement) {
  // Party legend grouped by kind.
  const byKind = new Map<string, string[]>();
  for (const [id, p] of Object.entries(DATA.parties)) {
    const list = byKind.get(p.kind) ?? [];
    list.push(id);
    byKind.set(p.kind, list);
  }
  const legendGroups = ["major", "minor", "indie", "bucket"]
    .filter((k) => byKind.has(k))
    .map((kind) =>
      h(
        "div.party-group",
        {},
        h("h4", {}, KIND_LABEL[kind] ?? kind),
        h(
          "div.party-chips",
          {},
          ...(byKind.get(kind) ?? []).map((id) => {
            const p = party(id);
            return h(
              "span.party-chip",
              {},
              h("span.party-swatch", { style: { background: p.color } }),
              p.name,
            );
          }),
        ),
      ),
    );

  // Assumptions.
  const assumptions = DATA.assumptions.map((a) =>
    h(
      "details.assumption",
      {},
      h(
        "summary",
        {},
        h("span", {}, a.summary),
        h(`span.conf.conf-${a.confidence}`, {}, a.confidence),
      ),
      h("p", {}, h("strong", {}, "Why: "), a.rationale),
      h("p", {}, h("strong", {}, "Impact: "), a.impact),
    ),
  );

  const children: Node[] = [
    h("h2.section-title", {}, "About this model"),
    h(
      "p.section-sub",
      {},
      "Powered by ",
      h(
        "a",
        { href: "https://github.com/boost-suite/tally", target: "_blank", rel: "noopener" },
        "open tally room",
      ),
      " — a zero-dependency, framework-agnostic election engine. The data and " +
        "every modelling choice are documented below.",
    ),
    h("div.party-legend", {}, ...legendGroups),
    h("h3.subhead", {}, "Modelling assumptions"),
  ];
  if (DATA.meta.notes) children.push(h("p.section-sub notes", {}, DATA.meta.notes));
  children.push(h("div.assumptions", {}, ...assumptions));

  clear(root).append(...children);
}
