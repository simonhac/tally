// Deterministic PRNG primitives for the Monte Carlo worker. Extracted verbatim
// from the original worker so the sampling stream is unchanged.

// Mulberry32 — fast, deterministic, good enough for MC. Returns uniform draws
// in [0, 1).
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Box-Muller. Returns one standard-normal draw; the second half of the pair is
// discarded — cheap enough at our N.
export function gaussian(rng: () => number): number {
  let u1 = rng();
  while (u1 === 0) u1 = rng();
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
