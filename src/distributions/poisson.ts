/**
 * Creates a sampler for the Poisson distribution using Knuth's algorithm.
 *
 * Suitable for small to moderate λ values. For very large λ (> 30),
 * a normal approximation may be more efficient but this remains correct.
 *
 * @param rng - A function returning pseudo-random numbers in [0, 1)
 * @param lambda - Expected number of occurrences (must be > 0)
 */
export function poisson(rng: () => number, lambda: number): () => number {
  if (lambda <= 0) throw new RangeError(`poisson: lambda (${lambda}) must be positive`);

  const L = Math.exp(-lambda);

  return () => {
    let k = 0;
    let p = 1;

    do {
      k++;
      p *= rng();
    } while (p > L);

    return k - 1;
  };
}
