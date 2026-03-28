/**
 * Creates a sampler for the exponential distribution using inverse transform sampling.
 *
 * @param rng - A function returning pseudo-random numbers in [0, 1)
 * @param rate - Rate parameter λ (must be > 0). Mean = 1/λ
 */
export function exponential(rng: () => number, rate: number): () => number {
  if (rate <= 0) throw new RangeError(`exponential: rate (${rate}) must be positive`);
  return () => -Math.log(1 - rng()) / rate;
}
