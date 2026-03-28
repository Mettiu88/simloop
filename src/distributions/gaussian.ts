/**
 * Creates a sampler for the Gaussian (normal) distribution using the Box-Muller transform.
 *
 * @param rng - A function returning pseudo-random numbers in [0, 1)
 * @param mean - Mean of the distribution (default 0)
 * @param stddev - Standard deviation (default 1)
 */
export function gaussian(rng: () => number, mean = 0, stddev = 1): () => number {
  if (stddev < 0) throw new RangeError(`gaussian: stddev (${stddev}) must be non-negative`);

  let spare: number | null = null;

  return () => {
    if (spare !== null) {
      const value = mean + stddev * spare;
      spare = null;
      return value;
    }

    let u: number, v: number, s: number;
    do {
      u = 2 * rng() - 1;
      v = 2 * rng() - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);

    const mul = Math.sqrt((-2 * Math.log(s)) / s);
    spare = v * mul;
    return mean + stddev * u * mul;
  };
}
