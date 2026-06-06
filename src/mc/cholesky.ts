// Build the multinomial covariance matrix's (k-1)×(k-1) leading principal minor
// and Cholesky-factorise it. Returns the lower-triangular L as a flat row-major
// array. Drops the last party in `shares`; it is reconstructed as the negative
// sum of the others' perturbations (which makes the full draw exactly zero-sum).
//
// The multinomial covariance is Σ_ii = p_i(1−p_i)/n, Σ_ij = −p_i p_j / n. The
// worker samples k-1 independent standard normals z, computes ε = L·z for the
// first k-1 parties, and recovers the k-th as −Σε — giving each party its proper
// σ AND the correct negative-correlation structure.
export function buildMultinomialCholesky(shares: number[], n: number): number[] {
  const km1 = shares.length - 1;
  if (km1 <= 0) return [];
  // Build A = leading (k-1)×(k-1) principal minor of Σ.
  const A: number[] = new Array(km1 * km1);
  for (let i = 0; i < km1; i++) {
    const p_i = shares[i];
    for (let j = 0; j < km1; j++) {
      const p_j = shares[j];
      A[i * km1 + j] = i === j ? (p_i * (1 - p_i)) / n : (-p_i * p_j) / n;
    }
  }
  // Standard Cholesky (Banachiewicz). For our sizes (k ≤ ~10) this is microseconds.
  const L = new Array<number>(km1 * km1).fill(0);
  for (let i = 0; i < km1; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = 0;
      for (let k = 0; k < j; k++) sum += L[i * km1 + k] * L[j * km1 + k];
      if (i === j) {
        L[i * km1 + j] = Math.sqrt(Math.max(0, A[i * km1 + i] - sum));
      } else {
        const pivot = L[j * km1 + j];
        L[i * km1 + j] = pivot > 0 ? (A[i * km1 + j] - sum) / pivot : 0;
      }
    }
  }
  return L;
}
