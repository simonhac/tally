// Tiny observable store holding the scenario and the uncertainty toggle.
// Sections subscribe and re-render on change. Swing edits go through the
// engine's own scenarioReducer so the absorber semantics match the library.

import {
  emptyScenario,
  scenarioReducer,
  seatsStateFromQuery,
  seatsStateToQuery,
  type ScenarioAction,
  type ScenarioState,
} from "@tally";
import { DATA } from "./engine";

type Listener = () => void;

const KNOWN_PARTIES = new Set(Object.keys(DATA.parties));

function readUrl(): ScenarioState {
  const parsed = seatsStateFromQuery(window.location.search, KNOWN_PARTIES, []);
  return {
    manualSwings: parsed.manualSwings ?? {},
    flowOverrides: {},
    onpDemographic: parsed.onpDemographic ?? {},
  };
}

let scenario: ScenarioState = readUrl();
let uncertainty = false;
const listeners = new Set<Listener>();

function emit() {
  for (const fn of listeners) fn();
}

// Reflect the scenario into the URL (shareable links) without spamming history.
function syncUrl() {
  const query = seatsStateToQuery(
    {
      view: "none",
      presetMode: "vic2022",
      manualSwings: scenario.manualSwings,
      onpDemographic: scenario.onpDemographic,
    },
    [],
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
