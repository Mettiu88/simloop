import { describe, it, expect } from 'vitest';
import { SeededRandom } from '../prng.js';
import { uniform, gaussian, exponential, poisson, bernoulli, zipf } from './index.js';

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
