/**
 * Creates a sampler for the Bernoulli distribution.
 * Returns 1 with probability p, 0 with probability 1-p.
 *
 * @param rng - A function returning pseudo-random numbers in [0, 1)
 * @param p - Probability of success (must be in [0, 1])
 */
export function bernoulli(rng: () => number, p: number): () => number {
  if (p < 0 || p > 1) throw new RangeError(`bernoulli: p (${p}) must be in [0, 1]`);
  return () => (rng() < p ? 1 : 0);
}
