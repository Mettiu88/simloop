/**
 * Creates a sampler for the geometric distribution using inverse transform sampling.
 *
 * Returns the number of trials needed to get the first success, where each
 * trial succeeds independently with probability p. The minimum value is 1.
 *
 * Examples: number of retries until a request succeeds, number of calls until
 * a sale is made, number of packets until the first drop.
 *
 * Mean = 1/p, Variance = (1-p) / p²
 *
 * @param rng - A function returning pseudo-random numbers in [0, 1)
 * @param p   - Success probability per trial (must be in (0, 1])
 */
export function geometric(rng: () => number, p: number): () => number {
  if (p <= 0 || p > 1) throw new RangeError(`geometric: p (${p}) must be in (0, 1]`);

  if (p === 1) return () => 1;
  return () => Math.ceil(Math.log(1 - rng()) / Math.log(1 - p));
}
