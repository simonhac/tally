// Quantile helper — summarises the raw per-sample arrays returned by the Monte
// Carlo run. Extracted verbatim from the original hook so the summary maths is
// unchanged.

export interface QuantileStats {
  mean: number;
  p05: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
}

export function computeQuantiles(xs: number[]): QuantileStats | null {
  if (xs.length === 0) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const n = sorted.length;
  const pick = (q: number) =>
    sorted[Math.max(0, Math.min(n - 1, Math.floor(q * n)))];
  let sum = 0;
  for (const x of xs) sum += x;
  return {
    mean: sum / n,
    p05: pick(0.05),
    p25: pick(0.25),
    p50: pick(0.5),
    p75: pick(0.75),
    p95: pick(0.95),
  };
}
