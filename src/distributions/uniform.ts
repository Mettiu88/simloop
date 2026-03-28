/**
 * Creates a sampler for the continuous uniform distribution on [a, b).
 *
 * @param rng - A function returning pseudo-random numbers in [0, 1)
 * @param a - Lower bound (inclusive)
 * @param b - Upper bound (exclusive)
 */
export function uniform(rng: () => number, a: number, b: number): () => number {
  if (a >= b) throw new RangeError(`uniform: a (${a}) must be less than b (${b})`);
  return () => a + rng() * (b - a);
}
