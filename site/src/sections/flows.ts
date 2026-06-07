// Preference-flow matrix — the signature visualization. Where each party's
// votes flow when it's excluded from the count. Measured-from-VEC rows are
// flagged "M"; estimated/proxy rows "e".

import { flowHeatmap } from "../charts";
import { clear, h } from "../dom";
import { DATA } from "../engine";

// One political-spectrum order used for BOTH axes so the self-preference
// diagonal lines up.
const FLOW_ORDER = ["alp", "grn", "ind_teal", "oth", "ind_country", "lib", "nat", "onp"];

export function renderFlows(root: HTMLElement) {
  const matrix = DATA.preferenceFlows.matrix;

  // Every party that is either an excluded source or a flow destination.
  const present = new Set<string>(Object.keys(matrix));
  for (const row of Object.values(matrix)) {
    for (const d of Object.keys(row.flows)) present.add(d);
  }
  const parties = [
    ...FLOW_ORDER.filter((p) => present.has(p)),
    ...[...present].filter((p) => !FLOW_ORDER.includes(p)).sort(),
  ];

  clear(root).append(
    h("h2.section-title", {}, "Where preferences go"),
    h(
      "p.section-sub",
      {},
      "Each row shows how an excluded party's ballots split across the field. " +
        "Cells are shaded by flow strength. ",
      h("span.badge-inline measured", {}, "M"),
      " = measured from VEC distribution-of-preferences; ",
      h("span.badge-inline estimated", {}, "e"),
      " = estimated or proxy.",
    ),
    h("div.heatmap-wrap", {}, flowHeatmap(parties, matrix)),
    h("p.source-line", {}, DATA.meta.flowMatrixSource),
  );
}
