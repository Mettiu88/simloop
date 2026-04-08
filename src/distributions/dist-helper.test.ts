import { describe, it, expect } from 'vitest';
import { SeededRandom } from '../prng.js';
import { createDistHelper } from './dist-helper.js';
import { exponential, gaussian, triangular, uniform } from './index.js';

function makeRng(seed = 42): () => number {
  const prng = new SeededRandom(seed);
  return () => prng.next();
}

describe('createDistHelper', () => {
  it('returns an object with all 11 distribution methods', () => {
    const dist = createDistHelper(makeRng());
    const expected = [
      'uniform', 'gaussian', 'exponential', 'poisson', 'bernoulli',
      'zipf', 'triangular', 'weibull', 'lognormal', 'erlang', 'geometric',
    ];
    for (const name of expected) {
      expect(typeof (dist as Record<string, unknown>)[name]).toBe('function');
    }
  });

  it('each method returns a sampler function', () => {
    const dist = createDistHelper(makeRng());
    expect(typeof dist.exponential(1)).toBe('function');
    expect(typeof dist.gaussian()).toBe('function');
    expect(typeof dist.uniform(0, 1)).toBe('function');
  });

  it('produces identical output to standalone functions with same seed', () => {
    const distHelper = createDistHelper(makeRng(99));
    const standalone = exponential(makeRng(99), 2);

    const helperSampler = distHelper.exponential(2);
    for (let i = 0; i < 20; i++) {
      expect(helperSampler()).toBe(standalone());
    }
  });

  it('produces identical output for gaussian with same seed', () => {
    const distHelper = createDistHelper(makeRng(77));
    const standalone = gaussian(makeRng(77), 10, 3);

    const helperSampler = distHelper.gaussian(10, 3);
    for (let i = 0; i < 20; i++) {
      expect(helperSampler()).toBe(standalone());
    }
  });

  it('produces identical output for triangular with same seed', () => {
    const distHelper = createDistHelper(makeRng(55));
    const standalone = triangular(makeRng(55), 1, 5, 10);

    const helperSampler = distHelper.triangular(1, 5, 10);
    for (let i = 0; i < 20; i++) {
      expect(helperSampler()).toBe(standalone());
    }
  });

  it('supports default parameters for gaussian', () => {
    const dist = createDistHelper(makeRng());
    const sampler = dist.gaussian();
    const value = sampler();
    expect(typeof value).toBe('number');
    expect(Number.isFinite(value)).toBe(true);
  });

  it('supports default parameters for lognormal', () => {
    const dist = createDistHelper(makeRng());
    const sampler = dist.lognormal();
    const value = sampler();
    expect(typeof value).toBe('number');
    expect(value).toBeGreaterThan(0);
  });

  it('preserves parameter validation from underlying functions', () => {
    const dist = createDistHelper(makeRng());
    expect(() => dist.exponential(-1)).toThrow(RangeError);
    expect(() => dist.uniform(5, 3)).toThrow(RangeError);
    expect(() => dist.poisson(0)).toThrow(RangeError);
    expect(() => dist.bernoulli(2)).toThrow(RangeError);
  });
});
