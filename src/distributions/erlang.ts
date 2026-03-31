/**
 * Creates a sampler for the Erlang distribution.
 *
 * The Erlang(k, rate) distribution is the sum of k independent exponential
 * random variables each with the given rate. It models the total time to
 * complete k sequential stages (e.g. a customer passing through k service phases).
 *
 * Special cases:
 * - k = 1: equivalent to exponential(rng, rate)
 * - k → ∞: approaches a deterministic value of k/rate
 *
 * Mean = k / rate, Variance = k / rate²
 *
 * @param rng  - A function returning pseudo-random numbers in [0, 1)
 * @param k    - Number of stages (positive integer, must be >= 1)
 * @param rate - Rate parameter λ of each stage (must be > 0). Mean of each stage = 1/λ
 */
export function erlang(rng: () => number, k: number, rate: number): () => number {
  if (!Number.isInteger(k) || k < 1) throw new RangeError(`erlang: k (${k}) must be a positive integer`);
  if (rate <= 0) throw new RangeError(`erlang: rate (${rate}) must be positive`);

  return () => {
    // Product of k uniform samples = sum of k exponential samples (inverse transform)
    let product = 1;
    for (let i = 0; i < k; i++) {
      product *= 1 - rng();
    }
    return -Math.log(product) / rate;
  };
}
