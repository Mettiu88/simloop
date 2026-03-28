/**
 * Seeded pseudo-random number generator using the Mulberry32 algorithm.
 * Produces deterministic sequences of numbers in [0, 1) given the same seed.
 */
export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed | 0;
  }

  /** Returns a pseudo-random number in [0, 1) */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Reset the PRNG to a new seed */
  reset(seed: number): void {
    this.state = seed | 0;
  }
}
