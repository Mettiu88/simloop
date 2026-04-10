/**
 * Queue Buffer Example
 *
 * A bounded production line: a producer generates items at random intervals
 * and pushes them into a buffer (Queue with maxCapacity=5). A consumer
 * dequeues items for processing at a slightly slower rate. When the buffer
 * is full, items are dropped.
 *
 * At the end, the simulation reports throughput, drop rate, and wait times.
 */
import { SimulationEngine, Queue } from '../../src/index.js';

// --- Types ---

type Events = {
  'item:produce': { itemId: number };
  'item:consume': Record<string, never>;
};

// --- Setup ---

const sim = new SimulationEngine<Events>({
  seed: 42,
  maxTime: 500,
  logLevel: 'silent',
});

const buffer = new Queue<number>('buffer', { maxCapacity: 5, overflowPolicy: 'drop' });

// --- Handlers ---

sim.on('item:produce', (event, ctx) => {
  buffer.enqueue(ctx, event.payload.itemId);

  // Schedule next production (mean inter-arrival = 1.0)
  ctx.schedule('item:produce', ctx.clock + ctx.dist.exponential(1.0)(), {
    itemId: event.payload.itemId + 1,
  });
});

sim.on('item:consume', (_e, ctx) => {
  const item = buffer.dequeue(ctx);
  if (item !== undefined) {
    ctx.stats.increment('consumed');
  }

  // Schedule next consumption (mean inter-service = 1.2, slightly slower than production)
  ctx.schedule('item:consume', ctx.clock + ctx.dist.exponential(1 / 1.2)(), {});
});

// --- Init ---

sim.init((ctx) => {
  ctx.schedule('item:produce', 0, { itemId: 1 });
  ctx.schedule('item:consume', 0.5, {});
});

// --- Run ---

const result = sim.run();

const enqueued = result.stats['queue.buffer.enqueued']?.count ?? 0;
const dequeued = result.stats['queue.buffer.dequeued']?.count ?? 0;
const dropped = result.stats['queue.buffer.dropped']?.count ?? 0;
const waitTime = result.stats['queue.buffer.waitTime'];

console.log('=== Queue Buffer Example ===');
console.log(`Sim time     : ${result.finalClock.toFixed(1)}`);
console.log(`Produced     : ${enqueued + dropped}`);
console.log(`Enqueued     : ${enqueued}`);
console.log(`Consumed     : ${dequeued}`);
console.log(`Dropped      : ${dropped}`);
console.log(`Drop rate    : ${(dropped / (enqueued + dropped) * 100).toFixed(1)} %`);
console.log(`Avg wait     : ${waitTime?.mean.toFixed(2) ?? 'N/A'}`);
console.log(`Max wait     : ${waitTime?.max.toFixed(2) ?? 'N/A'}`);
console.log(`Wall clock   : ${result.wallClockMs.toFixed(1)} ms`);
