// One Nation by region — a facsimile of the host app's OnpDemographicPanel.
// Four sliders pin ONP's primary share per demographic (0–50%). A pinned
// ("manual") region holds its dialled value; the rest are "automatic" and
// share the residual so the formal-vote-weighted average tracks the statewide
// ONP swing. The engine reshapes ONP across seats via raking (see
// resolveOnpModel in ../engine), so these pins genuinely move the projection.

import { DEMOGRAPHICS, ONP_DEMO_MAX, ONP_DEMO_MIN, type Demographic } from "@tally";
import { h } from "../dom";
import { DEMO_STATS, type OnpModel } from "../engine";
import { store } from "../state";

// One Nation orange, matching the dataset's party colour.
const ONP_COLOR = "#f26722";

function abbrev(d: Demographic): string {
  return d.replace(/Metropolitan/g, "Metro");
}

export interface OnpDemoPanel {
  el: HTMLElement;
  update(model: OnpModel): void;
}

export function createOnpDemoPanel(): OnpDemoPanel {
  const rows = new Map<
    Demographic,
    { row: HTMLElement; input: HTMLInputElement; num: HTMLElement }
  >();

  const sliders = DEMOGRAPHICS.map((d) => {
    const input = h("input.swing-slider", {
      type: "range",
      min: String(ONP_DEMO_MIN),
      max: String(ONP_DEMO_MAX),
      step: "0.1",
      value: "0",
      title: "Drag to pin · click the thumb to release back to automatic",
      "aria-label": `${abbrev(d)} One Nation primary share (percent)`,
    }) as HTMLInputElement;
    // Distinguish a click (toggle pin) from a drag (set value) by pointer
    // travel — a click on the thumb can snap the value a hair and fire `input`,
    // which must not swallow the toggle.
    let pressX: number | null = null; // clientX at pointerdown; null for keyboard
    let dragged = false;
    input.addEventListener("pointerdown", (e) => {
      pressX = e.clientX;
      dragged = false;
    });
    input.addEventListener("pointermove", (e) => {
      if (pressX !== null && Math.abs(e.clientX - pressX) > 3) dragged = true;
    });
    input.addEventListener("input", () => {
      if (pressX === null || dragged) {
        store.dispatch({ type: "set-onp-demo", demographic: d, value: Number(input.value) });
      }
    });
    // Click a pinned region's thumb to release it back to automatic.
    input.addEventListener("click", () => {
      const wasDrag = dragged;
      pressX = null;
      if (wasDrag) return;
      if (d in store.scenario.onpDemographic) {
        store.dispatch({ type: "release-onp-demo", demographic: d });
      } else {
        store.dispatch({ type: "set-onp-demo", demographic: d, value: Number(input.value) });
      }
    });
    const num = h("span.swing-num", {}, "0.0%");
    const row = h(
      "div.swing-row auto",
      {},
      h("span.swing-dot", { style: { background: ONP_COLOR } }),
      h("span.swing-name", {}, abbrev(d)),
      h("span.swing-track", {}, input),
      h("span.swing-val mono", {}, num),
    );
    rows.set(d, { row, input, num });
    return row;
  });

  const resetBtn = h(
    "button.btn-reset",
    {
      type: "button",
      onClick: () => store.dispatch({ type: "reset-onp-demo" }),
    },
    "Reset",
  );

  const subtitle = h("p.onp-demo-sub", {}, "");
  const warning = h("p.onp-demo-warning", {}, "");
  warning.style.display = "none";

  const el = h(
    "div.onp-demo-panel",
    {},
    h("div.panel-head", {}, h("h3", {}, "One Nation by region"), resetBtn),
    subtitle,
    ...sliders,
    warning,
  );

  function update(model: OnpModel): void {
    const onpDemo = store.scenario.onpDemographic;
    resetBtn.style.visibility =
      Object.keys(onpDemo).length > 0 ? "visible" : "hidden";

    let weightedAvg = 0;
    for (const d of DEMOGRAPHICS) {
      weightedAvg += model.resolvedOnpDemo[d] * DEMO_STATS.weights[d];
    }
    const onTarget = Math.abs(weightedAvg - model.statewideOnpPct) < 0.05;
    subtitle.textContent = onTarget
      ? `Primary share by region · weighted average tracks the One Nation swing (${model.statewideOnpPct.toFixed(1)}%).`
      : `Primary share by region · weighted average ${weightedAvg.toFixed(1)}% can't reach the One Nation swing of ${model.statewideOnpPct.toFixed(1)}%.`;

    // Raking fell back to per-seat redistribution: the pins are too extreme to
    // hold every other party's statewide total flat.
    const infeasible = !!model.resolvedOnpDemoForModel && !model.rakeFeasible;
    warning.style.display = infeasible ? "" : "none";
    if (infeasible) {
      warning.textContent =
        "These regional pins are too extreme to reconcile with the statewide " +
        "One Nation level — other parties' statewide totals will shift. Pull " +
        "the most extreme region (usually Rural) back to restore a flat ledger.";
    }

    for (const d of DEMOGRAPHICS) {
      const { row, input, num } = rows.get(d)!;
      const manual = d in onpDemo;
      const value = manual ? onpDemo[d] ?? 0 : model.resolvedOnpDemo[d];
      if (document.activeElement !== input) input.value = String(value);
      num.textContent = `${value.toFixed(1)}%`;
      row.classList.toggle("manual", manual);
      row.classList.toggle("auto", !manual);
    }
  }

  return { el, update };
}
