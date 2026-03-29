/**
 * Store Counter Example
 *
 * Minimal example showing how to use the global simulation store (`ctx.store`)
 * to accumulate custom data across event handlers.
 */
import { SimulationEngine } from '../../src/index.js';

// --- Types ---

type Events = {
  tick: { value: number };
};

type Store = {
  count: number;
  total: number;
};

// --- Setup ---

const sim = new SimulationEngine<Events, Store>({
  store: { count: 0, total: 0 },
  logLevel: 'silent',
});

sim.init((ctx) => {
  ctx.schedule('tick', 1, { value: 10 });
  ctx.schedule('tick', 2, { value: 20 });
  ctx.schedule('tick', 3, { value: 30 });
});

sim.on('tick', (event, ctx) => {
  ctx.store.count++;
  ctx.store.total += event.payload.value;
});

// --- Run ---

const result = sim.run();

console.log('Events processed:', result.totalEventsProcessed); // 3
console.log('Store:', result.store);                           // { count: 3, total: 60 }
