import type { StatsCollector, StatsSummary } from './types.js';

interface MetricState {
  count: number;
  sum: number;
  min: number;
  max: number;
  m2: number; // for Welford's online variance
}

const EMPTY_SUMMARY: StatsSummary = {
  count: 0,
  sum: 0,
  min: Infinity,
  max: -Infinity,
  mean: 0,
  variance: 0,
};

/**
 * Statistics collector using Welford's online algorithm for numerically stable
 * computation of mean and variance in a single pass.
 */
export class DefaultStatsCollector implements StatsCollector {
  private metrics = new Map<string, MetricState>();

  record(name: string, value: number): void {
    let m = this.metrics.get(name);
    if (!m) {
      m = { count: 0, sum: 0, min: Infinity, max: -Infinity, m2: 0 };
      this.metrics.set(name, m);
    }

    const oldMean = m.count > 0 ? m.sum / m.count : 0;
    m.count++;
    m.sum += value;
    if (value < m.min) m.min = value;
    if (value > m.max) m.max = value;

    // Welford's online algorithm
    const newMean = m.sum / m.count;
    const delta = value - oldMean;
    const delta2 = value - newMean;
    m.m2 += delta * delta2;
  }

  increment(name: string, by = 1): void {
    this.record(name, by);
  }

  get(name: string): StatsSummary {
    const m = this.metrics.get(name);
    if (!m) return { ...EMPTY_SUMMARY };
    return this.toSummary(m);
  }

  getAll(): Record<string, StatsSummary> {
    const result: Record<string, StatsSummary> = {};
    for (const [name, m] of this.metrics) {
      result[name] = this.toSummary(m);
    }
    return result;
  }

  reset(): void {
    this.metrics.clear();
  }

  private toSummary(m: MetricState): StatsSummary {
    const mean = m.count > 0 ? m.sum / m.count : 0;
    const variance = m.count > 1 ? m.m2 / (m.count - 1) : 0;
    return {
      count: m.count,
      sum: m.sum,
      min: m.min,
      max: m.max,
      mean,
      variance,
    };
  }
}
