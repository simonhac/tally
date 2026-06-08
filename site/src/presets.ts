// Named scenario presets surfaced as one-click buttons in the swing panel.
// Each preset's `id` doubles as the `?mode=` URL value. `swings` are
// percentage-point deltas off the 2022 statewide LA primaries; parties not
// listed auto-absorb the residual. Optional `onpDemographic` pins One Nation's
// share for some regions (any region omitted resolves automatically so the
// formal-vote-weighted average tracks the statewide ONP swing).
//
// Ported from victorias-electoral-wall's data/vic/vic-projection-2026.yaml so
// the demo showcases the engine's preset + ONP-demographic machinery.

import type { ScenarioPreset } from "@tally";

export const PRESETS: ScenarioPreset[] = [
  {
    id: "rm202604",
    label: "Roy Morgan (Apr 2026)",
    description:
      "Roy Morgan SMS poll of Victorian state voting intention, fielded " +
      "22–24 April 2026 (n=1,707). Swings land the statewide primaries on the " +
      "reported range midpoints: ALP 26.25, Coalition 25.50, ONP 23.75, Grn 12.25.",
    swings: {
      alp: -10.73,
      lib: -7.66,
      nat: -1.29,
      grn: 0.81,
      onp: 23.53,
    },
    // ONP regional shape supplied with the poll (Inner 8 / Outer 16 /
    // Provincial 25 / Rural 31), scaled so the formal-vote-weighted average
    // matches the 23.75% ONP midpoint. Rural is omitted so it auto-resolves to
    // close the gap to the statewide ONP share.
    onpDemographic: {
      "Inner Metropolitan": 9.8,
      "Outer Metropolitan": 19.6,
      Provincial: 30.6,
    },
  },
];
