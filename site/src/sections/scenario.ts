// The interactive heart: primary-swing sliders driving the real engine, four
// live projection cards (votes + seats × Assembly + Council), and an opt-in
// "Model uncertainty" mode — a multi-core Monte Carlo run (on demand, via the
// Run button) that layers animated whiskers onto the seat cards and reports
// P(Labor majority).

import { aggregateLaPrimaries, autoSwingDisplay, emptyScenario } from "@tally";
import { tweenNumber } from "../anim";
import { createBarChart, type BarValue } from "../charts";
import { clear, h } from "../dom";
import {
  DATA,
  foldCoalition,
  LA_MAJORITY,
  LA_TOTAL,
  LC_MAJORITY,
  LC_TOTAL,
  laVotes,
  lcVotes,
  party,
  projectLa,
  projectLc,
  resolveOnpModel,
  sumTally,
} from "../engine";
import { createMonteCarlo, MOE_PP, type McStats } from "../mc";
import { PRESETS } from "../presets";
import { store } from "../state";
import { createOnpDemoPanel } from "./onpDemo";

// Independents are carried per-seat in the dataset, so dialling them up flips
// the seats where they actually stand: teal (urban) in Hawthorn/Kew/Mornington,
// country in Benambra/Mildura/Shepparton.
const SLIDER_PARTIES = ["alp", "lib", "grn", "onp", "ind_teal", "ind_country"];
const DISPLAY_LA = ["alp", "coa", "grn", "onp", "ind", "oth"];
const DISPLAY_LC = ["alp", "coa", "grn", "onp", "lcn", "ajp", "dlp", "oth"];
const SWING_MIN = -35;
const SWING_MAX = 35;

const BASE = emptyScenario();
const BASE_SEATS_LA = foldCoalition(projectLa(BASE));
const BASE_VOTES_LA = pcts(laVotes(BASE));
const BASE_SEATS_LC = foldCoalition(projectLc(BASE));
const BASE_VOTES_LC = pcts(lcVotes(BASE));

export function renderScenario(root: HTMLElement) {
  const votesLa = createBarChart(DISPLAY_LA, { max: 100, unit: "pct" });
  const seatsLa = createBarChart(DISPLAY_LA, {
    max: LA_TOTAL,
    unit: "seats",
    threshold: LA_MAJORITY,
    thresholdLabel: `${LA_MAJORITY} to win`,
  });
  const votesLc = createBarChart(DISPLAY_LC, { max: 100, unit: "pct" });
  const seatsLc = createBarChart(DISPLAY_LC, {
    max: LC_TOTAL,
    unit: "seats",
    threshold: LC_MAJORITY,
    thresholdLabel: `${LC_MAJORITY} to win`,
  });

  const card = (title: string, chart: HTMLElement) =>
    h("div.chart-card", {}, h("h3.chart-title", {}, title), chart);

  // Slider rows. Each slider is either "locked" (the user has pinned a manual
  // swing) or "auto" (a free absorber that takes up the slack). Click a locked
  // slider's thumb to release it back to auto.
  const sliderRows = new Map<
    string,
    { row: HTMLElement; input: HTMLInputElement; num: HTMLElement }
  >();
  const sliders = SLIDER_PARTIES.map((id) => {
    const p = party(id);
    const input = h("input.swing-slider", {
      type: "range",
      min: String(SWING_MIN),
      max: String(SWING_MAX),
      step: "0.1",
      value: "0",
      title: "Drag to set · click the thumb to lock/unlock",
      "aria-label": `${p.name} primary swing (percentage points)`,
    }) as HTMLInputElement;
    // Distinguish a click (toggle lock) from a drag (set value) by pointer
    // travel, not by whether `input` fired — a click on the thumb can snap the
    // value a hair and fire `input`, which must not swallow the toggle.
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
      // Keyboard arrows (no active press) always set; a pointer only sets once
      // it has travelled far enough to count as a drag.
      if (pressX === null || dragged) {
        store.dispatch({ type: "set-swing", party: id, value: Number(input.value) });
      }
    });
    input.addEventListener("click", () => {
      const wasDrag = dragged;
      pressX = null;
      if (wasDrag) return;
      if (id in store.scenario.manualSwings) {
        store.dispatch({ type: "release-swing", party: id });
      } else {
        store.dispatch({ type: "set-swing", party: id, value: Number(input.value) });
      }
    });
    const num = h("span.swing-num", {}, "0.0");
    const row = h(
      "div.swing-row auto",
      {},
      h("span.swing-dot", { style: { background: p.color } }),
      h("span.swing-name", {}, p.name),
      h("span.swing-track", {}, input),
      h("span.swing-val mono", {}, num),
    );
    sliderRows.set(id, { row, input, num });
    return row;
  });

  const resetBtn = h(
    "button.btn-reset",
    { type: "button", onClick: () => store.dispatch({ type: "reset-all" }) },
    "Reset",
  );

  // One-click polling-scenario presets (e.g. Roy Morgan). Loading one pins the
  // poll's per-party swings and ONP regional shape; editing any slider after
  // detaches the scenario back to "custom".
  const presetRow = h(
    "div.preset-row",
    {},
    h("span.preset-label", {}, "Load a poll:"),
    ...PRESETS.map((p) =>
      h(
        "button.btn-preset",
        {
          type: "button",
          title: p.description ?? "",
          onClick: () => store.loadPreset(p),
        },
        p.label,
      ),
    ),
  );

  // One Nation by region — sliders that reshape ONP's per-demographic share.
  const onpDemo = createOnpDemoPanel();

  // Model-uncertainty toggle, controls (cores · MoE · Run), and readout.
  const toggle = h("input", {
    type: "checkbox",
    id: "unc-toggle",
  }) as HTMLInputElement;
  toggle.addEventListener("change", () => store.setUncertainty(toggle.checked));

  const pMajVal = h("span.pmaj-val mono", {}, "—");
  const pMajNote = h("span.pmaj-note", {}, "");
  const progressFill = h("span.mc-progress-fill");
  const progressBar = h("div.mc-progress", {}, progressFill);
  const pMajBox = h(
    "div.pmaj",
    {},
    h("span.pmaj-label", {}, "P(Labor majority)"),
    pMajVal,
    progressBar,
    pMajNote,
  );

  const uncMeta = h("span.unc-meta mono", {}, "");
  const runBtn = h(
    "button.btn-run",
    { type: "button", onClick: () => startRun() },
    "Run",
  ) as HTMLButtonElement;
  const uncControls = h(
    "div.unc-controls",
    {},
    h("div.unc-controls-head", {}, uncMeta, runBtn),
    pMajBox,
  );
  uncControls.style.display = "none";

  clear(root).append(
    h("h2.section-title", {}, "Build a scenario"),
    h(
      "p.section-sub",
      {},
      "Drag a primary swing (percentage points vs 2022). Untouched parties " +
        "automatically absorb the difference so the vote always totals 100%.",
    ),
    h(
      "div.scenario-grid",
      {},
      h(
        "div.panel.swing-panel",
        {},
        h("div.panel-head", {}, h("h3", {}, "Primary swings"), resetBtn),
        presetRow,
        ...sliders,
        onpDemo.el,
        h(
          "label.unc-row",
          { for: "unc-toggle" },
          toggle,
          h("span.unc-track", {}, h("span.unc-knob")),
          h(
            "span.unc-text",
            {},
            h("strong", {}, "Model uncertainty"),
            h("span.unc-help", {}, "Monte Carlo · 5-second run"),
          ),
        ),
        uncControls,
      ),
      h(
        "div.chart-cards",
        {},
        card("Votes — Legislative Assembly", votesLa.el),
        card("Seats — Legislative Assembly", seatsLa.el),
        card("Votes — Legislative Council", votesLc.el),
        card("Seats — Legislative Council", seatsLc.el),
      ),
    ),
  );

  // --- Monte Carlo wiring --------------------------------------------------
  let laWhiskers: McStats["laWhiskers"] = {};
  let lcWhiskers: McStats["lcWhiskers"] = {};
  let lastSeatsLa: Record<string, BarValue> = {};
  let lastSeatsLc: Record<string, BarValue> = {};
  let mcRunning = false;
  let mcHasResults = false;

  const mc = createMonteCarlo({
    onStats(stats) {
      if (!store.uncertainty) return;
      laWhiskers = stats.laWhiskers;
      lcWhiskers = stats.lcWhiskers;
      applyWhiskers();
      mcRunning = stats.running;
      if (!stats.running) mcHasResults = true;
      setRunBtn();
      if (Number.isNaN(stats.pMajority)) {
        pMajVal.textContent = "n/a";
        pMajNote.textContent = "workers unavailable";
        return;
      }
      tweenNumber(pMajVal, stats.pMajority * 100, (v) => `${v.toFixed(0)}%`);
      const draws = stats.samples.toLocaleString("en-AU");
      pMajNote.textContent = stats.running
        ? `sampling… ${draws} draws`
        : `${draws} draws · ${stats.cores} processor cores`;
    },
    onProgress(fraction, running) {
      progressFill.style.width = `${fraction * 100}%`;
      progressBar.classList.toggle("running", running);
    },
  });

  // Surface the pool size + simulated poll margin of error.
  uncMeta.textContent = mc.available
    ? `${mc.cores} ${mc.cores === 1 ? "processor core" : "processor cores"} · MoE ±${MOE_PP.toFixed(1)} pts`
    : "Monte Carlo unavailable in this browser";

  function applyWhiskers() {
    seatsLa.update(withWhiskers(lastSeatsLa, laWhiskers), true);
    seatsLc.update(withWhiskers(lastSeatsLc, lcWhiskers), true);
  }

  function setRunBtn() {
    if (!mc.available) {
      runBtn.disabled = true;
      runBtn.textContent = "Unavailable";
      return;
    }
    runBtn.disabled = mcRunning;
    runBtn.textContent = mcRunning ? "Running…" : mcHasResults ? "Run again" : "Run";
  }

  function startRun() {
    if (!mc.available || mcRunning) return;
    mcRunning = true;
    mcHasResults = false;
    pMajBox.style.display = "";
    pMajVal.textContent = "—";
    pMajNote.textContent = `sampling… · ${mc.cores} processor cores`;
    progressFill.style.width = "0%";
    setRunBtn();
    mc.run(store.scenario);
  }

  // Editing the scenario invalidates any prior run — stop it, drop the stale
  // bands, and wait for the user to press Run again.
  function resetMc() {
    mc.stop();
    mcRunning = false;
    mcHasResults = false;
    laWhiskers = {};
    lcWhiskers = {};
    progressFill.style.width = "0%";
    progressBar.classList.remove("running");
    pMajVal.textContent = "—";
    pMajBox.style.display = "none";
    setRunBtn();
  }

  function update() {
    const s = store.scenario;
    const onpModel = resolveOnpModel(s);

    // Deterministic projections for all four cards.
    lastSeatsLa = seatVals(DISPLAY_LA, foldCoalition(projectLa(s)), BASE_SEATS_LA);
    lastSeatsLc = seatVals(DISPLAY_LC, foldCoalition(projectLc(s)), BASE_SEATS_LC);
    seatsLa.update(lastSeatsLa, store.uncertainty);
    seatsLc.update(lastSeatsLc, store.uncertainty);
    votesLa.update(voteVals(DISPLAY_LA, pcts(laVotes(s)), BASE_VOTES_LA), false);
    votesLc.update(voteVals(DISPLAY_LC, pcts(lcVotes(s)), BASE_VOTES_LC), false);

    // Slider display values (manual = dialled; auto = absorbed).
    const agg = aggregateLaPrimaries(DATA.la.seats, s, { bucketIndies: false });
    const auto = autoSwingDisplay(agg, s.manualSwings);
    for (const [id, { row, input, num }] of sliderRows) {
      const manual = id in s.manualSwings;
      const value = manual ? s.manualSwings[id] : auto[id] ?? 0;
      if (document.activeElement !== input) input.value = String(value);
      num.textContent = `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(1)}`;
      row.classList.toggle("manual", manual);
      row.classList.toggle("auto", !manual);
    }
    resetBtn.style.visibility = store.isDirty() ? "visible" : "hidden";

    // One Nation by region.
    onpDemo.update(onpModel);

    // Model-uncertainty controls. Toggling on (or changing the scenario while
    // on) invalidates any prior run; the user presses Run to (re)sample.
    toggle.checked = store.uncertainty;
    uncControls.style.display = store.uncertainty ? "" : "none";
    resetMc();
  }

  store.subscribe(update);
  update();
}

function seatVals(
  display: string[],
  seats: Record<string, number>,
  base: Record<string, number>,
): Record<string, BarValue> {
  const out: Record<string, BarValue> = {};
  for (const id of display) {
    out[id] = { value: seats[id] ?? 0, baseline: base[id] ?? 0 };
  }
  return out;
}

function voteVals(
  display: string[],
  votes: Record<string, number>,
  base: Record<string, number>,
): Record<string, BarValue> {
  const out: Record<string, BarValue> = {};
  for (const id of display) {
    out[id] = { value: votes[id] ?? 0, baseline: base[id] ?? 0 };
  }
  return out;
}

function withWhiskers(
  values: Record<string, BarValue>,
  whiskers: Record<string, BarValue["whisker"]>,
): Record<string, BarValue> {
  const out: Record<string, BarValue> = {};
  for (const [id, v] of Object.entries(values)) {
    out[id] = { ...v, whisker: whiskers[id] };
  }
  return out;
}

function pcts(t: Record<string, number>): Record<string, number> {
  const total = sumTally(t);
  const out: Record<string, number> = {};
  if (total <= 0) return out;
  for (const [k, v] of Object.entries(t)) out[k] = (v / total) * 100;
  return out;
}
