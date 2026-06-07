// Reusable, animation-friendly chart primitives (vanilla DOM/SVG). Each
// builder constructs persistent nodes once and exposes an `update()` that only
// mutates geometry/text — so CSS transitions animate every change smoothly.

import { clear, fmtInt, fmtSigned, fmtSignedPct, h } from "./dom";
import { party, type Tally } from "./engine";

const pctStr = (n: number) => `${n}%`;

// ---------------------------------------------------------------------------
// Composition strip — one segmented bar of seats by party, with a majority
// marker. Static (built per render); used in the hero.
// ---------------------------------------------------------------------------
export function compositionBar(
  keys: string[],
  tally: Tally,
  total: number,
  majority: number,
): HTMLElement {
  const segs = keys.map((id) => {
    const p = party(id);
    const n = tally[id] ?? 0;
    return h(
      "span.comp-seg",
      {
        style: { width: pctStr((n / total) * 100), background: p.color },
        title: `${p.name}: ${n} ${n === 1 ? "seat" : "seats"}`,
      },
      n / total > 0.07 ? String(n) : "",
    );
  });
  return h(
    "div.comp-bar",
    {},
    ...segs,
    h("span.comp-majority", {
      style: { left: pctStr((majority / total) * 100) },
      title: `Majority: ${majority}`,
    }),
  );
}

// ---------------------------------------------------------------------------
// Horizontal bar chart with persistent rows. Drives both the votes chart
// (unit "pct") and the seats chart (unit "seats", with optional uncertainty
// whiskers overlaid on each bar).
// ---------------------------------------------------------------------------
export interface BarValue {
  value: number;
  baseline?: number;
  whisker?: { p05: number; p25: number; p50: number; p75: number; p95: number };
}

export interface BarChartHandle {
  el: HTMLElement;
  update(values: Record<string, BarValue>, showWhiskers: boolean): void;
}

interface RowRefs {
  row: HTMLElement;
  fill: HTMLElement;
  whisker: HTMLElement;
  box: HTMLElement;
  line: HTMLElement;
  median: HTMLElement;
  value: HTMLElement;
  change: HTMLElement;
}

export function createBarChart(
  partyIds: string[],
  cfg: {
    max: number;
    unit: "pct" | "seats";
    threshold?: number;
    thresholdLabel?: string;
  },
): BarChartHandle {
  const refs = new Map<string, RowRefs>();
  const rowEls: HTMLElement[] = [];

  for (const id of partyIds) {
    const p = party(id);
    const fill = h("span.bar-fill", { style: { background: p.color } });
    const box = h("span.wk-box");
    const line = h("span.wk-line");
    const median = h("span.wk-median");
    const whisker = h("span.bar-whisker", {}, line, box, median);
    const value = h("span.bar-value mono");
    const change = h("span.bar-change mono");
    const track = h("span.bar-track", {}, fill, whisker);
    const row = h(
      "div.bar-row",
      { dataset: { id } },
      h(
        "span.bar-label",
        {},
        h("span.bar-dot", { style: { background: p.color } }),
        h("span.bar-name", {}, p.name),
      ),
      track,
      value,
      change,
    );
    refs.set(id, { row, fill, whisker, box, line, median, value, change });
    rowEls.push(row);
  }

  const rowsEl = h("div.chart-rows", {}, ...rowEls);
  // Threshold marker lives in an overlay whose left/right insets match the
  // track grid column, so its percentage maps to the bar track (not the full
  // row including the label/value columns).
  const overlay =
    cfg.threshold != null
      ? h(
          "div.threshold-overlay",
          {},
          h("span.chart-threshold", {
            style: { left: pctStr((cfg.threshold / cfg.max) * 100) },
            dataset: { label: cfg.thresholdLabel ?? "" },
          }),
        )
      : null;
  const el = h(
    "div.bar-chart",
    { dataset: { unit: cfg.unit } },
    overlay,
    rowsEl,
  );

  function update(values: Record<string, BarValue>, showWhiskers: boolean) {
    const whiskerMode = showWhiskers && cfg.unit === "seats";
    el.classList.toggle("show-whiskers", whiskerMode);
    for (const [id, r] of refs) {
      const v = values[id];
      const wk = v?.whisker;
      // With whiskers on, the bar represents the Monte Carlo MEDIAN so the bar
      // end, the median tick and the box line up. Otherwise it's the
      // deterministic projection.
      const value = whiskerMode && wk ? wk.p50 : v?.value ?? 0;
      const present = value > 0.0001 || (v?.baseline ?? 0) > 0.0001;
      r.row.classList.toggle("is-empty", !present);
      r.fill.style.width = pctStr((value / cfg.max) * 100);

      if (cfg.unit === "seats") {
        r.value.textContent = String(Math.round(value));
        const change = value - (v?.baseline ?? value);
        setChange(r.change, change, fmtSigned);
      } else {
        r.value.textContent = `${value.toFixed(1)}%`;
        const change = value - (v?.baseline ?? value);
        setChange(r.change, change, fmtSignedPct);
      }

      if (whiskerMode && wk) {
        const pos = (n: number) => pctStr((n / cfg.max) * 100);
        r.whisker.style.opacity = "1";
        r.line.style.left = pos(wk.p05);
        r.line.style.width = pctStr(((wk.p95 - wk.p05) / cfg.max) * 100);
        r.box.style.left = pos(wk.p25);
        r.box.style.width = pctStr(((wk.p75 - wk.p25) / cfg.max) * 100);
        r.median.style.left = pos(wk.p50);
      } else {
        r.whisker.style.opacity = "0";
      }
    }
  }

  return { el, update };
}

function setChange(
  el: HTMLElement,
  change: number,
  fmt: (n: number) => string,
) {
  const txt = fmt(change);
  el.textContent = txt === "—" || txt === "0" ? "" : txt;
  el.classList.toggle("up", change > 0.05);
  el.classList.toggle("down", change < -0.05);
}

// ---------------------------------------------------------------------------
// Preference-flow heatmap — the signature visualization. Rows = source party
// (excluded), columns = destination, cell shade = flow fraction.
// ---------------------------------------------------------------------------
export function flowHeatmap(
  parties: string[],
  matrix: Record<
    string,
    { flows: Record<string, number>; measured?: boolean; assumption?: string }
  >,
): HTMLElement {
  // Rows (excluded party) and columns (destination) share one order, so the
  // self-preference diagonal lines up and can be greyed out as impossible.
  // Compact codes — the raw IND_TEAL / IND_COUNTRY ids are too long for a tight
  // matrix.
  const SHORT: Record<string, string> = { ind_teal: "TEAL", ind_country: "CTRY" };
  const code = (id: string) => SHORT[id] ?? party(id).code;

  const headRow = h(
    "div.hm-row hm-head",
    {},
    h("span.hm-corner", { title: "rows = excluded party, columns = destination" }, "↓ src"),
    ...parties.map((d) =>
      h(
        "span.hm-colhead",
        { title: party(d).name },
        h("span.hm-dot", { style: { background: party(d).color } }),
        code(d),
      ),
    ),
  );

  const bodyRows = parties.map((src) => {
    const row = matrix[src];
    const cells = parties.map((d) => {
      if (d === src) {
        // A party never receives its own preferences after it's excluded.
        return h("span.hm-cell hm-diag", {
          title: `${party(src).name} — not applicable`,
        });
      }
      const f = row?.flows[d] ?? 0;
      const pctTxt = f > 0 ? `${Math.round(f * 100)}` : "";
      return h(
        "span.hm-cell",
        {
          style: {
            background: shade(party(d).color, f),
            color: f > 0.5 ? "#fff" : "#3a3a3a",
          },
          title: `${party(src).name} → ${party(d).name}: ${(f * 100).toFixed(1)}%`,
        },
        pctTxt,
      );
    });
    return h(
      "div.hm-row",
      {},
      h(
        "span.hm-rowhead",
        { title: row?.assumption ?? "" },
        h("span.hm-dot", { style: { background: party(src).color } }),
        h("span.hm-rowcode", {}, code(src)),
        row?.measured
          ? h("span.hm-badge measured", { title: "Measured from VEC DoP" }, "M")
          : h("span.hm-badge estimated", { title: "Estimated / proxy" }, "e"),
      ),
      ...cells,
    );
  });

  // Set the column template inline with a LITERAL count — CSS repeat() will not
  // accept a custom-property count, so `repeat(var(--n), …)` collapses to one
  // column.
  return h(
    "div.heatmap",
    { style: { gridTemplateColumns: `74px repeat(${parties.length}, 38px)` } },
    headRow,
    ...bodyRows,
  );
}

// Blend a party colour over white by fraction f (0→white, 1→full colour).
function shade(hex: string, f: number): string {
  const c = hex.replace("#", "");
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  const t = Math.max(0, Math.min(1, f));
  const mix = (x: number) => Math.round(255 + (x - 255) * t);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

// Re-exported so sections can drop a fresh composition strip in.
export { clear, fmtInt, h };
