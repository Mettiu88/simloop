/**
 * Creates a sampler for the lognormal distribution.
 *
 * If X ~ Gaussian(mu, sigma), then e^X ~ Lognormal(mu, sigma).
 * Models quantities that are the product of many independent factors:
 * service times, repair durations, response times, file sizes.
 *
 * The parameters mu and sigma are the mean and standard deviation of the
 * underlying normal distribution (i.e. of log(X)), not of X itself.
 *
 * Relationship to observable mean and variance of X:
 *   mean(X)  = exp(mu + sigma² / 2)
 *   var(X)   = (exp(sigma²) - 1) * exp(2*mu + sigma²)
 *
 * @param rng   - A function returning pseudo-random numbers in [0, 1)
 * @param mu    - Mean of the underlying normal distribution (default 0)
 * @param sigma - Standard deviation of the underlying normal distribution (must be >= 0, default 1)
 */
export function lognormal(rng: () => number, mu = 0, sigma = 1): () => number {
  if (sigma < 0) throw new RangeError(`lognormal: sigma (${sigma}) must be non-negative`);

  // Box-Muller to generate normal samples, then exponentiate
  let spare: number | null = null;

  return () => {
    let z: number;

    if (spare !== null) {
      z = spare;
      spare = null;
    } else {
      let u: number, v: number, s: number;
      do {
        u = 2 * rng() - 1;
        v = 2 * rng() - 1;
        s = u * u + v * v;
      } while (s >= 1 || s === 0);

      const mul = Math.sqrt((-2 * Math.log(s)) / s);
      spare = v * mul;
      z = u * mul;
    }

    return Math.exp(mu + sigma * z);
  };
}
