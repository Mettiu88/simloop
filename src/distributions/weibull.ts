/**
 * Creates a sampler for the Weibull distribution using inverse transform sampling.
 *
 * Widely used in reliability and failure analysis:
 * - shape < 1: decreasing failure rate (early failures / infant mortality)
 * - shape = 1: constant failure rate (equivalent to exponential with rate = 1/scale)
 * - shape > 1: increasing failure rate (wear-out / aging)
 *
 * @param rng   - A function returning pseudo-random numbers in [0, 1)
 * @param scale - Scale parameter λ (must be > 0). Controls the spread. Mean ≈ scale * Γ(1 + 1/shape)
 * @param shape - Shape parameter k (must be > 0). Controls the failure rate behaviour.
 */
export function weibull(rng: () => number, scale: number, shape: number): () => number {
  if (scale <= 0) throw new RangeError(`weibull: scale (${scale}) must be positive`);
  if (shape <= 0) throw new RangeError(`weibull: shape (${shape}) must be positive`);

  return () => scale * Math.pow(-Math.log(1 - rng()), 1 / shape);
}
