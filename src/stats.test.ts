import { describe, it, expect } from 'vitest';
import { DefaultStatsCollector } from './stats.js';

describe('DefaultStatsCollector', () => {
  it('should return empty summary for unknown metric', () => {
    const stats = new DefaultStatsCollector();
    const s = stats.get('unknown');
    expect(s.count).toBe(0);
    expect(s.sum).toBe(0);
    expect(s.mean).toBe(0);
  });

  it('should track count, sum, min, max, mean', () => {
    const stats = new DefaultStatsCollector();
    stats.record('latency', 10);
    stats.record('latency', 20);
    stats.record('latency', 30);

    const s = stats.get('latency');
    expect(s.count).toBe(3);
    expect(s.sum).toBe(60);
    expect(s.min).toBe(10);
    expect(s.max).toBe(30);
    expect(s.mean).toBe(20);
  });

  it('should compute variance correctly', () => {
    const stats = new DefaultStatsCollector();
    // Values: 2, 4, 4, 4, 5, 5, 7, 9
    // Mean = 5, Variance (sample) = 4.571...
    [2, 4, 4, 4, 5, 5, 7, 9].forEach((v) => stats.record('x', v));

    const s = stats.get('x');
    expect(s.mean).toBe(5);
    expect(s.variance).toBeCloseTo(4.571, 2);
  });

  it('should increment as a counter', () => {
    const stats = new DefaultStatsCollector();
    stats.increment('requests');
    stats.increment('requests');
    stats.increment('requests', 3);

    const s = stats.get('requests');
    expect(s.count).toBe(3);
    expect(s.sum).toBe(5);
  });

  it('should track multiple independent metrics', () => {
    const stats = new DefaultStatsCollector();
    stats.record('a', 10);
    stats.record('b', 20);

    const all = stats.getAll();
    expect(Object.keys(all)).toHaveLength(2);
    expect(all['a'].sum).toBe(10);
    expect(all['b'].sum).toBe(20);
  });

  it('should reset all metrics', () => {
    const stats = new DefaultStatsCollector();
    stats.record('x', 100);
    stats.reset();

    expect(stats.get('x').count).toBe(0);
    expect(Object.keys(stats.getAll())).toHaveLength(0);
  });
});
