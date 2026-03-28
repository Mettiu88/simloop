/**
 * Creates a sampler for the Zipf distribution using rejection-inversion sampling.
 *
 * Returns integers in [1, n] where the probability of rank k is proportional to 1/k^s.
 *
 * @param rng - A function returning pseudo-random numbers in [0, 1)
 * @param n - Number of elements (must be >= 1)
 * @param s - Exponent parameter (must be > 0)
 */
export function zipf(rng: () => number, n: number, s: number): () => number {
  if (n < 1 || !Number.isInteger(n)) throw new RangeError(`zipf: n (${n}) must be a positive integer`);
  if (s <= 0) throw new RangeError(`zipf: s (${s}) must be positive`);

  // Precompute the CDF for rejection sampling
  const weights = new Float64Array(n);
  let total = 0;
  for (let i = 0; i < n; i++) {
    total += 1 / Math.pow(i + 1, s);
    weights[i] = total;
  }

  return () => {
    const u = rng() * total;
    // Binary search for the rank
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (weights[mid] < u) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return lo + 1; // 1-indexed rank
  };
}
