import type {
  Demographic,
  Party,
  PartyId,
  ScenarioPreset,
} from "./types";
import { ONP_DEMO_MAX, ONP_DEMO_MIN } from "./scenario";

export type SeatsView = "all" | "changing" | "none";
// `"vic2022"` and `"custom"` are built-in; every other value must match a
// preset id loaded from `data/vic/vic-projection-2026.yaml`.
export type PresetMode = string;

export interface SeatsUrlState {
  view: SeatsView;
  presetMode: PresetMode;
  manualSwings: Record<PartyId, number>;
  onpDemographic: Partial<Record<Demographic, number>>;
  actor?: PartyId | null;
}

const ONP_DEMO_CODES: Record<Demographic, string> = {
  "Inner Metropolitan": "im",
  "Outer Metropolitan": "om",
  Provincial: "p",
  Rural: "r",
};
const ONP_DEMO_BY_CODE: Record<string, Demographic> = {
  im: "Inner Metropolitan",
  om: "Outer Metropolitan",
  p: "Provincial",
  r: "Rural",
};

// A handful of common aliases that don't match either an id or a yaml
// label exactly. Keep this list tiny — the canonical match path is
// "id or label, case-insensitive". Lib/Nat individually route to the
// Coalition row since that's what FundingTable shows.
const ACTOR_ALIASES: Record<string, PartyId> = {
  lnp: "coa",
  liberal: "coa",
  nationals: "coa",
  national: "coa",
  alp: "alp",
  labour: "alp",
  greens: "grn",
  green: "grn",
  onp: "onp",
  "one nation": "onp",
};

// Resolve a free-form `?actor=…` value to a row id used by the funding
// table. Matches against PartyId, party.label, and a small alias table —
// all case-insensitive. Returns null for unknown values.
export function resolveActorParam(
  raw: string | null | undefined,
  parties: Record<PartyId, Party>,
): PartyId | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  if (!key) return null;
  if (parties[key]) return key;
  for (const [id, p] of Object.entries(parties)) {
    if (p.label.toLowerCase() === key) return id;
  }
  if (ACTOR_ALIASES[key]) return ACTOR_ALIASES[key];
  return null;
}

export const SEATS_URL_DEFAULTS: SeatsUrlState = {
  view: "none",
  presetMode: "vic2022",
  manualSwings: {},
  onpDemographic: {},
};

const SWING_MIN = -30;
const SWING_MAX = 30;

const VIEW_VALUES: ReadonlySet<SeatsView> = new Set(["all", "changing", "none"]);
const BUILTIN_MODES: ReadonlySet<PresetMode> = new Set(["vic2022", "custom"]);

function modeIsValid(
  mode: string,
  presets: readonly ScenarioPreset[],
): boolean {
  if (BUILTIN_MODES.has(mode)) return true;
  return presets.some((p) => p.id === mode);
}

function findPreset(
  mode: string,
  presets: readonly ScenarioPreset[],
): ScenarioPreset | undefined {
  return presets.find((p) => p.id === mode);
}

function fmt(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? r.toString() : r.toFixed(1);
}

// True iff `manual` matches `preset` at the one-decimal precision used on
// the wire. Lets us drop the redundant `swings=…` tail when the preset
// mode already implies these values.
function swingsEqualPreset(
  manual: Record<PartyId, number>,
  preset: Record<PartyId, number>,
): boolean {
  const manualKeys = Object.keys(manual);
  const presetKeys = Object.keys(preset);
  if (manualKeys.length !== presetKeys.length) return false;
  for (const k of presetKeys) {
    if (!(k in manual)) return false;
    if (fmt(manual[k]) !== fmt(preset[k])) return false;
  }
  return true;
}

// True iff `manual` matches `preset` on the four demographic pins at the
// one-decimal precision used on the wire.
function onpDemoEqualPreset(
  manual: Partial<Record<Demographic, number>>,
  preset: Partial<Record<Demographic, number>>,
): boolean {
  const manualKeys = Object.keys(manual);
  const presetKeys = Object.keys(preset);
  if (manualKeys.length !== presetKeys.length) return false;
  for (const k of presetKeys as Demographic[]) {
    if (!(k in manual)) return false;
    if (fmt(manual[k] ?? 0) !== fmt(preset[k] ?? 0)) return false;
  }
  return true;
}

export function seatsStateToQuery(
  s: SeatsUrlState,
  presets: readonly ScenarioPreset[],
): string {
  const parts: string[] = [];
  if (s.view !== SEATS_URL_DEFAULTS.view) parts.push(`show=${s.view}`);
  if (s.presetMode !== SEATS_URL_DEFAULTS.presetMode) {
    parts.push(`mode=${s.presetMode}`);
  }
  const activePreset = findPreset(s.presetMode, presets);
  const swingEntries = Object.entries(s.manualSwings);
  const swingsImpliedByMode =
    !!activePreset && swingsEqualPreset(s.manualSwings, activePreset.swings);
  if (swingEntries.length > 0 && !swingsImpliedByMode) {
    const encoded = swingEntries
      .map(([p, v]) => `${p}:${fmt(v)}`)
      .join(",");
    parts.push(`swings=${encoded}`);
  }
  const onpDemoEntries = Object.entries(s.onpDemographic) as [
    Demographic,
    number,
  ][];
  const onpDemoImpliedByMode =
    !!activePreset &&
    !!activePreset.onpDemographic &&
    onpDemoEqualPreset(s.onpDemographic, activePreset.onpDemographic);
  if (onpDemoEntries.length > 0 && !onpDemoImpliedByMode) {
    const encoded = onpDemoEntries
      .map(([d, v]) => `${ONP_DEMO_CODES[d]}:${fmt(v)}`)
      .join(",");
    parts.push(`onpD=${encoded}`);
  }
  if (s.actor) parts.push(`actor=${s.actor}`);
  return parts.length ? "?" + parts.join("&") : "";
}

export function seatsStateFromQuery(
  search: string,
  knownParties: ReadonlySet<PartyId>,
  presets: readonly ScenarioPreset[],
): Partial<SeatsUrlState> {
  const out: Partial<SeatsUrlState> = {};
  if (!search) return out;
  const params = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search,
  );

  const showRaw = params.get("show");
  if (showRaw && VIEW_VALUES.has(showRaw as SeatsView)) {
    out.view = showRaw as SeatsView;
  }

  const modeRaw = params.get("mode");
  if (modeRaw && modeIsValid(modeRaw, presets)) {
    out.presetMode = modeRaw;
  }

  const activePreset =
    out.presetMode !== undefined ? findPreset(out.presetMode, presets) : undefined;

  const swingsRaw = params.get("swings");
  if (swingsRaw) {
    const swings: Record<PartyId, number> = {};
    for (const entry of swingsRaw.split(",")) {
      const idx = entry.indexOf(":");
      if (idx <= 0) continue;
      const party = entry.slice(0, idx);
      const valStr = entry.slice(idx + 1);
      if (!knownParties.has(party)) continue;
      const n = parseFloat(valStr);
      if (!isFinite(n)) continue;
      const clamped = Math.max(SWING_MIN, Math.min(SWING_MAX, n));
      swings[party] = Math.round(clamped * 10) / 10;
    }
    if (Object.keys(swings).length > 0) out.manualSwings = swings;
  } else if (activePreset) {
    const swings: Record<PartyId, number> = {};
    for (const [party, value] of Object.entries(activePreset.swings)) {
      if (knownParties.has(party)) swings[party] = value;
    }
    if (Object.keys(swings).length > 0) out.manualSwings = swings;
  }

  const onpDemoRaw = params.get("onpD");
  if (onpDemoRaw) {
    const onpDemo: Partial<Record<Demographic, number>> = {};
    for (const entry of onpDemoRaw.split(",")) {
      const idx = entry.indexOf(":");
      if (idx <= 0) continue;
      const code = entry.slice(0, idx);
      const demo = ONP_DEMO_BY_CODE[code];
      if (!demo) continue;
      const n = parseFloat(entry.slice(idx + 1));
      if (!isFinite(n)) continue;
      const clamped = Math.max(ONP_DEMO_MIN, Math.min(ONP_DEMO_MAX, n));
      onpDemo[demo] = Math.round(clamped * 10) / 10;
    }
    if (Object.keys(onpDemo).length > 0) out.onpDemographic = onpDemo;
  } else if (activePreset && activePreset.onpDemographic) {
    out.onpDemographic = { ...activePreset.onpDemographic };
  }

  return out;
}
