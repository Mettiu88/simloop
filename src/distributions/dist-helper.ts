import type { DistributionHelper } from '../types.js';
import { uniform } from './uniform.js';
import { gaussian } from './gaussian.js';
import { exponential } from './exponential.js';
import { poisson } from './poisson.js';
import { bernoulli } from './bernoulli.js';
import { zipf } from './zipf.js';
import { triangular } from './triangular.js';
import { weibull } from './weibull.js';
import { lognormal } from './lognormal.js';
import { erlang } from './erlang.js';
import { geometric } from './geometric.js';

/**
 * Creates a DistributionHelper with `rng` pre-bound to all distribution factories.
 *
 * @param rng - A function returning pseudo-random numbers in [0, 1)
 */
export function createDistHelper(rng: () => number): DistributionHelper {
  return {
    uniform: (a, b) => uniform(rng, a, b),
    gaussian: (mean?, stddev?) => gaussian(rng, mean, stddev),
    exponential: (rate) => exponential(rng, rate),
    poisson: (lambda) => poisson(rng, lambda),
    bernoulli: (p) => bernoulli(rng, p),
    zipf: (n, s) => zipf(rng, n, s),
    triangular: (min, mode, max) => triangular(rng, min, mode, max),
    weibull: (scale, shape) => weibull(rng, scale, shape),
    lognormal: (mu?, sigma?) => lognormal(rng, mu, sigma),
    erlang: (k, rate) => erlang(rng, k, rate),
    geometric: (p) => geometric(rng, p),
  };
}
