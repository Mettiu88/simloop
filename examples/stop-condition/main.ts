/**
 * Stop Condition Example
 *
 * Demonstrates the `stopWhen` option to halt a simulation when a custom
 * condition is met. Here we model a simple sampling process: each event
 * draws a random value and records it as a statistic. The simulation
 * stops as soon as the running mean stabilises — i.e., when enough
 * samples have been collected (count >= 200) and the coefficient of
 * variation (CV = stddev / mean) drops below a threshold.
 */
import { SimulationEngine } from '../../src/index.js';

// --- Types ---

type Events = {
  sample: Record<string, never>;
};

// --- Configuration ---

const CV_THRESHOLD = 0.35; // stop when CV < 35 % (theoretical CV for this lognormal ≈ 0.31)
const MIN_SAMPLES = 200;

const sim = new SimulationEngine<Events>({
  seed: 123,
  logLevel: 'silent',

  stopWhen: (ctx) => {
    const s = ctx.stats.get('value');
    if (s.count < MIN_SAMPLES) return false;
    const cv = Math.sqrt(s.variance) / Math.abs(s.mean);
    return cv < CV_THRESHOLD;
  },
});

// --- Handlers ---

sim.on('sample', (_event, ctx) => {
  // Draw from a lognormal distribution (right-skewed, mean ≈ e^(mu + sigma²/2))
  const value = ctx.dist.lognormal(2, 0.3)();
  ctx.stats.record('value', value);

  // Schedule next sample at t + 1
  ctx.schedule('sample', ctx.clock + 1, {});
});

// --- Init ---

sim.init((ctx) => {
  ctx.schedule('sample', 0, {});
});

// --- Run ---

const result = sim.run();

const stats = result.stats['value'];
const cv = Math.sqrt(stats.variance) / Math.abs(stats.mean);

console.log('=== Stop Condition Example ===');
console.log(`Status       : ${result.status}`);
console.log(`Samples      : ${stats.count}`);
console.log(`Mean         : ${stats.mean.toFixed(4)}`);
console.log(`Std dev      : ${Math.sqrt(stats.variance).toFixed(4)}`);
console.log(`CV           : ${(cv * 100).toFixed(2)} %`);
console.log(`Sim time     : ${result.finalClock}`);
console.log(`Wall clock   : ${result.wallClockMs.toFixed(1)} ms`);
