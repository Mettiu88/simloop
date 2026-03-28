import { describe, it, expect } from 'vitest';
import { SeededRandom } from './prng.js';

describe('SeededRandom', () => {
  it('should produce deterministic sequences from the same seed', () => {
    const rng1 = new SeededRandom(42);
    const rng2 = new SeededRandom(42);

    for (let i = 0; i < 100; i++) {
      expect(rng1.next()).toBe(rng2.next());
    }
  });

  it('should produce different sequences from different seeds', () => {
    const rng1 = new SeededRandom(42);
    const rng2 = new SeededRandom(99);

    const seq1 = Array.from({ length: 10 }, () => rng1.next());
    const seq2 = Array.from({ length: 10 }, () => rng2.next());

    expect(seq1).not.toEqual(seq2);
  });

  it('should produce values in [0, 1)', () => {
    const rng = new SeededRandom(123);
    for (let i = 0; i < 10000; i++) {
      const val = rng.next();
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThan(1);
    }
  });

  it('should reset to produce the same sequence', () => {
    const rng = new SeededRandom(42);
    const first = Array.from({ length: 10 }, () => rng.next());

    rng.reset(42);
    const second = Array.from({ length: 10 }, () => rng.next());

    expect(first).toEqual(second);
  });
});
