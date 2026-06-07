// Tiny hyperscript helper — keeps the section builders readable without a
// framework. `h("div.foo", {title:"x"}, child, child)`.

type Child = Node | string | number | null | undefined | false;

export function h(
  selector: string,
  props?: Record<string, unknown> | null,
  ...children: Child[]
): HTMLElement {
  const [tag, ...classes] = selector.split(".");
  const el = document.createElement(tag || "div");
  if (classes.length) el.className = classes.join(" ");
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = String(v);
      else if (k === "html") el.innerHTML = String(v);
      else if (k === "style" && typeof v === "object") {
        Object.assign(el.style, v as object);
      } else if (k.startsWith("on") && typeof v === "function") {
        el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      } else if (k === "dataset" && typeof v === "object") {
        Object.assign(el.dataset, v as object);
      } else {
        el.setAttribute(k, String(v));
      }
    }
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el: HTMLElement): HTMLElement {
  el.replaceChildren();
  return el;
}

// Number formatting helpers shared across sections.
export const fmtInt = (n: number) => Math.round(n).toLocaleString("en-AU");
export const fmtPct1 = (n: number) => `${n.toFixed(1)}%`;
export const fmtSigned = (n: number) => {
  const r = Math.round(n * 10) / 10;
  if (r === 0) return "0";
  return `${r > 0 ? "+" : "−"}${Math.abs(r)}`;
};
export const fmtSignedPct = (n: number) => {
  const r = Math.round(n * 10) / 10;
  if (Math.abs(r) < 0.05) return "—";
  return `${r > 0 ? "+" : "−"}${Math.abs(r).toFixed(1)}`;
};
