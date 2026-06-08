// Tiny observable store holding the scenario and the uncertainty toggle.
// Sections subscribe and re-render on change. Swing edits go through the
// engine's own scenarioReducer so the absorber semantics match the library.

import {
  scenarioReducer,
  seatsStateFromQuery,
  seatsStateToQuery,
  type ScenarioAction,
  type ScenarioPreset,
  type ScenarioState,
} from "@tally";
import { DATA } from "./engine";
import { PRESETS } from "./presets";

type Listener = () => void;

const KNOWN_PARTIES = new Set(Object.keys(DATA.parties));

function readUrl(): { scenario: ScenarioState; presetMode: string } {
  const parsed = seatsStateFromQuery(
    window.location.search,
    KNOWN_PARTIES,
    PRESETS,
  );
  return {
    scenario: {
      manualSwings: parsed.manualSwings ?? {},
      flowOverrides: {},
      onpDemographic: parsed.onpDemographic ?? {},
    },
    presetMode: parsed.presetMode ?? "vic2022",
  };
}

const initial = readUrl();
let scenario: ScenarioState = initial.scenario;
// "vic2022" (baseline) / "custom" (user-edited) / a preset id when an
// unmodified preset is loaded — drives the clean `?mode=` URL.
let presetMode = initial.presetMode;
let uncertainty = false;
const listeners = new Set<Listener>();

function emit() {
  for (const fn of listeners) fn();
}

// Reflect the scenario into the URL (shareable links) without spamming history.
// An unmodified preset collapses to `?mode=<id>`; any edit falls back to the
// explicit `?swings=…`/`?onpD=…` form.
function syncUrl() {
  const query = seatsStateToQuery(
    {
      view: "none",
      presetMode,
      manualSwings: scenario.manualSwings,
      onpDemographic: scenario.onpDemographic,
    },
    PRESETS,
  );
  const url = query || window.location.pathname;
  window.history.replaceState(null, "", url);
}

export const store = {
  get scenario(): ScenarioState {
    return scenario;
  },
  get uncertainty(): boolean {
    return uncertainty;
  },
  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  dispatch(action: ScenarioAction) {
    scenario = scenarioReducer(scenario, action);
    // Any hand edit detaches from the preset; a full reset returns to baseline.
    presetMode = action.type === "reset-all" ? "vic2022" : "custom";
    syncUrl();
    emit();
  },
  loadPreset(preset: ScenarioPreset) {
    scenario = {
      manualSwings: { ...preset.swings },
      flowOverrides: {},
      onpDemographic: { ...(preset.onpDemographic ?? {}) },
    };
    presetMode = preset.id;
    syncUrl();
    emit();
  },
  setUncertainty(on: boolean) {
    if (uncertainty === on) return;
    uncertainty = on;
    emit();
  },
  isDirty(): boolean {
    return (
      Object.keys(scenario.manualSwings).length > 0 ||
      Object.keys(scenario.onpDemographic).length > 0
    );
  },
};
