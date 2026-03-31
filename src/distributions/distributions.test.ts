import { describe, it, expect } from 'vitest';
import { SeededRandom } from '../prng.js';
import { uniform, gaussian, exponential, poisson, bernoulli, zipf, triangular, weibull, lognormal, erlang, geometric } from './index.js';

const SAMPLES = 10_000;

function makeRng(seed = 42): () => number {
  const prng = new SeededRandom(seed);
  return () => prng.next();
}

// ---------------------------------------------------------------------------
// Uniform
// ---------------------------------------------------------------------------
describe('uniform', () => {
  it('generates values within [a, b)', () => {
    const sample = uniform(makeRng(), 2, 5);
    for (let i = 0; i < SAMPLES; i++) {
      const v = sample();
      expect(v).toBeGreaterThanOrEqual(2);
      expect(v).toBeLessThan(5);
    }
  });

  it('has mean ≈ (a+b)/2', () => {
    const sample = uniform(makeRng(), 10, 20);
    let sum = 0;
    for (let i = 0; i < SAMPLES; i++) sum += sample();
    expect(sum / SAMPLES).toBeCloseTo(15, 0);
  });

  it('throws if a >= b', () => {
    expect(() => uniform(makeRng(), 5, 5)).toThrow(RangeError);
    expect(() => uniform(makeRng(), 6, 3)).toThrow(RangeError);
  });

  it('is deterministic with the same seed', () => {
    const a = uniform(makeRng(99), 0, 100);
    const b = uniform(makeRng(99), 0, 100);
    for (let i = 0; i < 20; i++) expect(a()).toBe(b());
  });
});

// ---------------------------------------------------------------------------
// Gaussian
// ---------------------------------------------------------------------------
describe('gaussian', () => {
  it('has mean ≈ μ', () => {
    const sample = gaussian(makeRng(), 5, 2);
    let sum = 0;
    for (let i = 0; i < SAMPLES; i++) sum += sample();
    expect(sum / SAMPLES).toBeCloseTo(5, 0);
  });

  it('has stddev ≈ σ', () => {
    const mu = 0;
    const sigma = 3;
    const sample = gaussian(makeRng(), mu, sigma);
    const values: number[] = [];
    for (let i = 0; i < SAMPLES; i++) values.push(sample());
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
    expect(Math.sqrt(variance)).toBeCloseTo(sigma, 0);
  });

  it('defaults to standard normal (μ=0, σ=1)', () => {
    const sample = gaussian(makeRng());
    let sum = 0;
    for (let i = 0; i < SAMPLES; i++) sum += sample();
    expect(sum / SAMPLES).toBeCloseTo(0, 0);
  });

  it('throws if stddev is negative', () => {
    expect(() => gaussian(makeRng(), 0, -1)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// Exponential
// ---------------------------------------------------------------------------
describe('exponential', () => {
  it('generates non-negative values', () => {
    const sample = exponential(makeRng(), 1);
    for (let i = 0; i < SAMPLES; i++) {
      expect(sample()).toBeGreaterThanOrEqual(0);
    }
  });

  it('has mean ≈ 1/λ', () => {
    const rate = 2;
    const sample = exponential(makeRng(), rate);
    let sum = 0;
    for (let i = 0; i < SAMPLES; i++) sum += sample();
    expect(sum / SAMPLES).toBeCloseTo(1 / rate, 1);
  });

  it('throws if rate <= 0', () => {
    expect(() => exponential(makeRng(), 0)).toThrow(RangeError);
    expect(() => exponential(makeRng(), -1)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// Poisson
// ---------------------------------------------------------------------------
describe('poisson', () => {
  it('generates non-negative integers', () => {
    const sample = poisson(makeRng(), 4);
    for (let i = 0; i < SAMPLES; i++) {
      const v = sample();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('has mean ≈ λ', () => {
    const lambda = 7;
    const sample = poisson(makeRng(), lambda);
    let sum = 0;
    for (let i = 0; i < SAMPLES; i++) sum += sample();
    expect(sum / SAMPLES).toBeCloseTo(lambda, 0);
  });

  it('throws if lambda <= 0', () => {
    expect(() => poisson(makeRng(), 0)).toThrow(RangeError);
    expect(() => poisson(makeRng(), -2)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// Bernoulli
// ---------------------------------------------------------------------------
describe('bernoulli', () => {
  it('returns only 0 or 1', () => {
    const sample = bernoulli(makeRng(), 0.5);
    for (let i = 0; i < SAMPLES; i++) {
      const v = sample();
      expect(v === 0 || v === 1).toBe(true);
    }
  });

  it('has mean ≈ p', () => {
    const p = 0.3;
    const sample = bernoulli(makeRng(), p);
    let sum = 0;
    for (let i = 0; i < SAMPLES; i++) sum += sample();
    expect(sum / SAMPLES).toBeCloseTo(p, 1);
  });

  it('p=0 always returns 0', () => {
    const sample = bernoulli(makeRng(), 0);
    for (let i = 0; i < 100; i++) expect(sample()).toBe(0);
  });

  it('p=1 always returns 1', () => {
    const sample = bernoulli(makeRng(), 1);
    for (let i = 0; i < 100; i++) expect(sample()).toBe(1);
  });

  it('throws if p is out of [0, 1]', () => {
    expect(() => bernoulli(makeRng(), -0.1)).toThrow(RangeError);
    expect(() => bernoulli(makeRng(), 1.1)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// Zipf
// ---------------------------------------------------------------------------
describe('zipf', () => {
  it('generates integers in [1, n]', () => {
    const sample = zipf(makeRng(), 10, 1);
    for (let i = 0; i < SAMPLES; i++) {
      const v = sample();
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(10);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('rank 1 is the most frequent', () => {
    const n = 5;
    const sample = zipf(makeRng(), n, 1);
    const counts = new Array(n).fill(0);
    for (let i = 0; i < SAMPLES; i++) counts[sample() - 1]++;
    // Rank 1 should have the highest count
    expect(counts[0]).toBeGreaterThan(counts[1]);
    expect(counts[1]).toBeGreaterThan(counts[n - 1]);
  });

  it('higher s concentrates more on rank 1', () => {
    const n = 10;
    const lowS = zipf(makeRng(1), n, 0.5);
    const highS = zipf(makeRng(1), n, 2);

    let lowCount = 0;
    let highCount = 0;
    for (let i = 0; i < SAMPLES; i++) {
      if (lowS() === 1) lowCount++;
      if (highS() === 1) highCount++;
    }
    expect(highCount).toBeGreaterThan(lowCount);
  });

  it('throws for invalid parameters', () => {
    expect(() => zipf(makeRng(), 0, 1)).toThrow(RangeError);
    expect(() => zipf(makeRng(), 1.5, 1)).toThrow(RangeError);
    expect(() => zipf(makeRng(), 10, 0)).toThrow(RangeError);
    expect(() => zipf(makeRng(), 10, -1)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// Triangular
// ---------------------------------------------------------------------------
describe('triangular', () => {
  it('generates values within [min, max]', () => {
    const sample = triangular(makeRng(), 2, 5, 10);
    for (let i = 0; i < SAMPLES; i++) {
      const v = sample();
      expect(v).toBeGreaterThanOrEqual(2);
      expect(v).toBeLessThanOrEqual(10);
    }
  });

  it('has mean ≈ (min + mode + max) / 3', () => {
    const [min, mode, max] = [2, 5, 10];
    const sample = triangular(makeRng(), min, mode, max);
    let sum = 0;
    for (let i = 0; i < SAMPLES; i++) sum += sample();
    expect(sum / SAMPLES).toBeCloseTo((min + mode + max) / 3, 0);
  });

  it('works when mode = min (left-skewed triangle)', () => {
    const sample = triangular(makeRng(), 0, 0, 10);
    let sum = 0;
    for (let i = 0; i < SAMPLES; i++) sum += sample();
    expect(sum / SAMPLES).toBeCloseTo((0 + 0 + 10) / 3, 0);
  });

  it('works when mode = max (right-skewed triangle)', () => {
    const sample = triangular(makeRng(), 0, 10, 10);
    let sum = 0;
    for (let i = 0; i < SAMPLES; i++) sum += sample();
    expect(sum / SAMPLES).toBeCloseTo((0 + 10 + 10) / 3, 0);
  });

  it('throws for invalid parameters', () => {
    expect(() => triangular(makeRng(), 5, 3, 10)).toThrow(RangeError); // mode < min
    expect(() => triangular(makeRng(), 0, 11, 10)).toThrow(RangeError); // mode > max
    expect(() => triangular(makeRng(), 10, 5, 5)).toThrow(RangeError); // min >= max
  });
});

// ---------------------------------------------------------------------------
// Weibull
// ---------------------------------------------------------------------------
describe('weibull', () => {
  it('generates non-negative values', () => {
    const sample = weibull(makeRng(), 1, 1.5);
    for (let i = 0; i < SAMPLES; i++) {
      expect(sample()).toBeGreaterThanOrEqual(0);
    }
  });

  it('with shape=1 behaves like exponential (mean ≈ scale)', () => {
    // Weibull(scale, 1) == Exponential(rate=1/scale), mean = scale
    const scale = 3;
    const sample = weibull(makeRng(), scale, 1);
    let sum = 0;
    for (let i = 0; i < SAMPLES; i++) sum += sample();
    expect(sum / SAMPLES).toBeCloseTo(scale, 0);
  });

  it('higher shape produces less variance (wear-out regime)', () => {
    const computeVariance = (shape: number) => {
      const sample = weibull(makeRng(1), 1, shape);
      const values = Array.from({ length: SAMPLES }, () => sample());
      const mean = values.reduce((a, b) => a + b, 0) / SAMPLES;
      return values.reduce((a, b) => a + (b - mean) ** 2, 0) / SAMPLES;
    };
    expect(computeVariance(5)).toBeLessThan(computeVariance(1));
  });

  it('throws for invalid parameters', () => {
    expect(() => weibull(makeRng(), 0, 1)).toThrow(RangeError);
    expect(() => weibull(makeRng(), -1, 1)).toThrow(RangeError);
    expect(() => weibull(makeRng(), 1, 0)).toThrow(RangeError);
    expect(() => weibull(makeRng(), 1, -1)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// Lognormal
// ---------------------------------------------------------------------------
describe('lognormal', () => {
  it('generates positive values only', () => {
    const sample = lognormal(makeRng(), 0, 1);
    for (let i = 0; i < SAMPLES; i++) {
      expect(sample()).toBeGreaterThan(0);
    }
  });

  it('has mean ≈ exp(mu + sigma²/2)', () => {
    const [mu, sigma] = [1, 0.5];
    const expectedMean = Math.exp(mu + (sigma * sigma) / 2);
    const sample = lognormal(makeRng(), mu, sigma);
    let sum = 0;
    for (let i = 0; i < SAMPLES; i++) sum += sample();
    expect(sum / SAMPLES).toBeCloseTo(expectedMean, 0);
  });

  it('sigma=0 returns constant exp(mu)', () => {
    const mu = 2;
    const sample = lognormal(makeRng(), mu, 0);
    for (let i = 0; i < 10; i++) {
      expect(sample()).toBeCloseTo(Math.exp(mu), 10);
    }
  });

  it('throws for invalid parameters', () => {
    expect(() => lognormal(makeRng(), 0, -1)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// Erlang
// ---------------------------------------------------------------------------
describe('erlang', () => {
  it('generates non-negative values', () => {
    const sample = erlang(makeRng(), 3, 1);
    for (let i = 0; i < SAMPLES; i++) {
      expect(sample()).toBeGreaterThanOrEqual(0);
    }
  });

  it('has mean ≈ k / rate', () => {
    const [k, rate] = [4, 2];
    const sample = erlang(makeRng(), k, rate);
    let sum = 0;
    for (let i = 0; i < SAMPLES; i++) sum += sample();
    expect(sum / SAMPLES).toBeCloseTo(k / rate, 0);
  });

  it('k=1 behaves like exponential', () => {
    const rate = 0.5;
    const sampleE = erlang(makeRng(7), 1, rate);
    const sampleExp = exponential(makeRng(7), rate);
    // Same seed, same algorithm — results must match
    for (let i = 0; i < 20; i++) {
      expect(sampleE()).toBeCloseTo(sampleExp(), 10);
    }
  });

  it('higher k produces less relative variance', () => {
    const computeCV = (k: number) => {
      const sample = erlang(makeRng(1), k, 1);
      const values = Array.from({ length: SAMPLES }, () => sample());
      const mean = values.reduce((a, b) => a + b, 0) / SAMPLES;
      const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / SAMPLES;
      return Math.sqrt(variance) / mean; // coefficient of variation = 1/√k
    };
    expect(computeCV(1)).toBeGreaterThan(computeCV(4));
  });

  it('throws for invalid parameters', () => {
    expect(() => erlang(makeRng(), 0, 1)).toThrow(RangeError);
    expect(() => erlang(makeRng(), 1.5, 1)).toThrow(RangeError);
    expect(() => erlang(makeRng(), -1, 1)).toThrow(RangeError);
    expect(() => erlang(makeRng(), 2, 0)).toThrow(RangeError);
    expect(() => erlang(makeRng(), 2, -1)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// Geometric
// ---------------------------------------------------------------------------
describe('geometric', () => {
  it('generates positive integers only', () => {
    const sample = geometric(makeRng(), 0.3);
    for (let i = 0; i < SAMPLES; i++) {
      const v = sample();
      expect(v).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('has mean ≈ 1/p', () => {
    const p = 0.25;
    const sample = geometric(makeRng(), p);
    let sum = 0;
    for (let i = 0; i < SAMPLES; i++) sum += sample();
    expect(sum / SAMPLES).toBeCloseTo(1 / p, 0);
  });

  it('p=1 always returns 1', () => {
    const sample = geometric(makeRng(), 1);
    for (let i = 0; i < 20; i++) {
      expect(sample()).toBe(1);
    }
  });

  it('higher p produces smaller mean', () => {
    const mean = (p: number) => {
      const sample = geometric(makeRng(1), p);
      let sum = 0;
      for (let i = 0; i < SAMPLES; i++) sum += sample();
      return sum / SAMPLES;
    };
    expect(mean(0.8)).toBeLessThan(mean(0.2));
  });

  it('throws for invalid parameters', () => {
    expect(() => geometric(makeRng(), 0)).toThrow(RangeError);
    expect(() => geometric(makeRng(), -0.1)).toThrow(RangeError);
    expect(() => geometric(makeRng(), 1.1)).toThrow(RangeError);
  });
});
