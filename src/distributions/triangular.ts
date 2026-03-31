/**
 * Creates a sampler for the triangular distribution using inverse transform sampling.
 *
 * Useful when only three-point estimates are available (min, mode, max) and no
 * historical data exists — common in project management (PERT) and early-stage modeling.
 *
 * @param rng  - A function returning pseudo-random numbers in [0, 1)
 * @param min  - Lower bound (must be < max)
 * @param mode - Peak of the distribution (must satisfy min <= mode <= max)
 * @param max  - Upper bound (must be > min)
 */
export function triangular(rng: () => number, min: number, mode: number, max: number): () => number {
  if (min >= max) throw new RangeError(`triangular: min (${min}) must be less than max (${max})`);
  if (mode < min || mode > max) throw new RangeError(`triangular: mode (${mode}) must be between min (${min}) and max (${max})`);

  const range = max - min;
  const fc = (mode - min) / range; // CDF at the mode

  return () => {
    const u = rng();
    if (u < fc) {
      return min + Math.sqrt(u * range * (mode - min));
    } else {
      return max - Math.sqrt((1 - u) * range * (max - mode));
    }
  };
}
