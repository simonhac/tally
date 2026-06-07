// Minimal requestAnimationFrame number tween. Used for the P(majority)
// read-out so it counts up smoothly rather than snapping as Monte Carlo
// samples stream in. Bar/whisker geometry is animated with CSS transitions;
// this handles the one value CSS can't (text content).

const handles = new WeakMap<HTMLElement, number>();
const current = new WeakMap<HTMLElement, number>();

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

export function tweenNumber(
  el: HTMLElement,
  to: number,
  format: (v: number) => string,
  durationMs = 450,
): void {
  const from = current.get(el) ?? to;
  const prev = handles.get(el);
  if (prev) cancelAnimationFrame(prev);

  if (from === to) {
    current.set(el, to);
    el.textContent = format(to);
    return;
  }

  let start = 0;
  const step = (ts: number) => {
    if (!start) start = ts;
    const t = Math.min(1, (ts - start) / durationMs);
    const v = from + (to - from) * easeOutCubic(t);
    current.set(el, v);
    el.textContent = format(v);
    if (t < 1) {
      handles.set(el, requestAnimationFrame(step));
    } else {
      current.set(el, to);
      el.textContent = format(to);
    }
  };
  handles.set(el, requestAnimationFrame(step));
}
