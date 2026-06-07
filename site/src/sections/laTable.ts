// Legislative Assembly seat table — all 88 single-member seats with 2CP
// winner + margin, a stacked primary-vote mini-bar, and click-to-expand
// primaries. Static (baseline data); sortable by name / margin / region.

import { clear, fmtInt, fmtPct1, h } from "../dom";
import { DATA, party } from "../engine";
import type { SeatBaseline } from "@tally";

type SortKey = "name" | "region" | "margin";

function prettyRegion(id: string): string {
  return id
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

function primaryBar(seat: SeatBaseline): HTMLElement {
  const entries = Object.entries(seat.primaries).sort((a, b) => b[1] - a[1]);
  return h(
    "span.mini-bar",
    {},
    ...entries.map(([id, v]) => {
      const p = party(id);
      return h("span.mini-seg", {
        style: { width: `${(v / seat.formal) * 100}%`, background: p.color },
        title: `${p.name}: ${fmtInt(v)} (${fmtPct1((v / seat.formal) * 100)})`,
      });
    }),
  );
}

function detail(seat: SeatBaseline): HTMLElement {
  const entries = Object.entries(seat.primaries).sort((a, b) => b[1] - a[1]);
  const win = party(seat.twoCp.winner);
  const lose = party(seat.twoCp.loser);
  return h(
    "div.seat-detail",
    {},
    h(
      "div.detail-primaries",
      {},
      h("h4", {}, "First preferences"),
      ...entries.map(([id, v]) => {
        const p = party(id);
        return h(
          "div.detail-row",
          {},
          h("span.detail-dot", { style: { background: p.color } }),
          h("span.detail-name", {}, p.name),
          h("span.detail-votes mono", {}, fmtInt(v)),
          h("span.detail-pct mono", {}, fmtPct1((v / seat.formal) * 100)),
        );
      }),
    ),
    h(
      "div.detail-2cp",
      {},
      h("h4", {}, "Two-candidate preferred"),
      h(
        "p",
        {},
        h("strong", { style: { color: win.color } }, win.name),
        ` ${fmtPct1(seat.twoCp.winnerPct)} `,
        h("span.muted", {}, "def. "),
        h("strong", { style: { color: lose.color } }, lose.name),
        ` ${fmtPct1(100 - seat.twoCp.winnerPct)}`,
      ),
      h("p.muted", {}, `Formal votes: ${fmtInt(seat.formal)}`),
      seat.calibration ? h("p.muted", {}, seat.calibration) : null,
    ),
  );
}

export function renderLaTable(root: HTMLElement) {
  let sort: SortKey = "name";
  let asc = true;

  const tbody = h("div.seat-rows");

  function rows() {
    const seats = [...DATA.la.seats].sort((a, b) => {
      let d = 0;
      if (sort === "name") d = a.name.localeCompare(b.name);
      else if (sort === "region") d = a.region.localeCompare(b.region) || a.name.localeCompare(b.name);
      else d = a.twoCp.winnerPct - b.twoCp.winnerPct;
      return asc ? d : -d;
    });
    clear(tbody);
    for (const seat of seats) {
      const win = party(seat.twoCp.winner);
      const margin = seat.twoCp.winnerPct - 50;
      const row = h(
        "div.seat-row",
        { tabindex: "0", role: "button" },
        h("span.cell-name", {}, seat.name),
        h("span.cell-region muted", {}, prettyRegion(seat.region)),
        h(
          "span.cell-win",
          {},
          h("span.win-dot", { style: { background: win.color } }),
          win.code,
        ),
        h("span.cell-margin mono", {}, `${margin >= 0 ? "+" : "−"}${Math.abs(margin).toFixed(1)}`),
        h("span.cell-bar", {}, primaryBar(seat)),
      );
      const det = detail(seat);
      det.style.display = "none";
      const wrapper = h("div.seat-item", {}, row, det);
      const toggle = () => {
        const open = det.style.display !== "none";
        det.style.display = open ? "none" : "";
        wrapper.classList.toggle("open", !open);
      };
      row.addEventListener("click", toggle);
      row.addEventListener("keydown", (e) => {
        if ((e as KeyboardEvent).key === "Enter" || (e as KeyboardEvent).key === " ") {
          e.preventDefault();
          toggle();
        }
      });
      tbody.append(wrapper);
    }
  }

  function header(label: string, key: SortKey, cls: string) {
    const el = h(
      `button.col-head.${cls}`,
      {
        type: "button",
        onClick: () => {
          if (sort === key) asc = !asc;
          else {
            sort = key;
            asc = key !== "margin";
          }
          rows();
          markSort();
        },
      },
      label,
      h("span.sort-caret", {}, ""),
    );
    el.dataset.key = key;
    return el;
  }

  const nameH = header("Seat", "name", "cell-name");
  const regionH = header("Region", "region", "cell-region");
  const marginH = header("Margin", "margin", "cell-margin");
  const heads = h(
    "div.seat-head",
    {},
    nameH,
    regionH,
    h("span.col-head cell-win", {}, "2CP"),
    marginH,
    h("span.col-head cell-bar", {}, "First preferences"),
  );

  function markSort() {
    for (const el of [nameH, regionH, marginH]) {
      const active = el.dataset.key === sort;
      el.classList.toggle("active", active);
      const caret = el.querySelector(".sort-caret");
      if (caret) caret.textContent = active ? (asc ? "▲" : "▼") : "";
    }
  }

  clear(root).append(
    h("h2.section-title", {}, "Every seat, 2022"),
    h(
      "p.section-sub",
      {},
      "All 88 Legislative Assembly results — click any seat for its full first " +
        "preferences and two-candidate count.",
    ),
    h("div.seat-table", {}, heads, tbody),
  );
  rows();
  markSort();
}
