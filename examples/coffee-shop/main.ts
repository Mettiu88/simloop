/**
 * Coffee Shop Simulation
 *
 * A discrete event simulation of a coffee shop with:
 * - Customers arriving at random intervals
 * - Multiple baristas preparing drinks
 * - Different drink types with different preparation times
 * - Customer patience: if the queue is too long, they leave
 *
 * Demonstrates: entity management, event cancellation, dynamic scheduling,
 * seeded PRNG, statistics collection, and lifecycle hooks.
 */

import { SimulationEngine } from '../../src/index.js';
import type { SimEvent, SimContext } from '../../src/index.js';

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

type DrinkType = 'espresso' | 'cappuccino' | 'latte' | 'cold-brew';

interface DrinkSpec {
  name: DrinkType;
  prepTime: { min: number; max: number }; // minutes
  popularity: number; // relative weight for random selection
}

const DRINKS: DrinkSpec[] = [
  { name: 'espresso', prepTime: { min: 1, max: 2 }, popularity: 4 },
  { name: 'cappuccino', prepTime: { min: 2, max: 4 }, popularity: 3 },
  { name: 'latte', prepTime: { min: 2.5, max: 4.5 }, popularity: 2 },
  { name: 'cold-brew', prepTime: { min: 0.5, max: 1.5 }, popularity: 1 },
];

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CONFIG = {
  numBaristas: 2,
  avgArrivalInterval: 2.5, // avg minutes between customers
  maxQueuePatience: 8, // minutes a customer is willing to wait in line
  simulationDuration: 480, // 8-hour shift in minutes
  seed: 12345,
};

// ---------------------------------------------------------------------------
// Event map — all event types and their payloads
// ---------------------------------------------------------------------------

type CoffeeShopEvents = {
  'customer:arrive': { customerId: string };
  'customer:leave-queue': { customerId: string; reason: 'impatient' };
  'barista:start-order': { baristaId: string; customerId: string; drink: DrinkType };
  'barista:finish-order': { baristaId: string; customerId: string; drink: DrinkType };
};

// ---------------------------------------------------------------------------
// Entity state shapes
// ---------------------------------------------------------------------------

interface CustomerState {
  arrivedAt: number;
  drink: DrinkType;
  patienceTimeout: SimEvent | null; // reference to the leave-queue event for cancellation
}

interface BaristaState {
  busy: boolean;
  ordersCompleted: number;
}

interface ShopState {
  queue: string[]; // customer IDs waiting in line
}

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

function exponentialRandom(u: number, rate: number): number {
  return -Math.log(1 - u) / rate;
}

function uniformRandom(u: number, min: number, max: number): number {
  return min + u * (max - min);
}

function pickDrink(u: number): DrinkSpec {
  const totalWeight = DRINKS.reduce((sum, d) => sum + d.popularity, 0);
  let threshold = u * totalWeight;
  for (const drink of DRINKS) {
    threshold -= drink.popularity;
    if (threshold <= 0) return drink;
  }
  return DRINKS[DRINKS.length - 1];
}

// ---------------------------------------------------------------------------
// Simulation setup
// ---------------------------------------------------------------------------

const sim = new SimulationEngine<CoffeeShopEvents>({
  seed: CONFIG.seed,
  maxTime: CONFIG.simulationDuration,
  logLevel: 'info',
  name: 'CoffeeShop',
});

// --- Customer arrives ---
sim.on('customer:arrive', (event, ctx) => {
  const { customerId } = event.payload;
  const shop = ctx.getEntity<ShopState>('shop')!;
  const drink = pickDrink(ctx.random());

  ctx.stats.increment('totalArrivals');
  ctx.log('debug', `${customerId} arrives, wants a ${drink.name}`);

  // Add customer entity
  ctx.addEntity<CustomerState>({
    id: customerId,
    state: { arrivedAt: ctx.clock, drink: drink.name, patienceTimeout: null },
  });

  // Add to the shop queue
  shop.state.queue.push(customerId);

  // Schedule patience timeout — customer leaves if not served in time
  const patienceTime = uniformRandom(ctx.random(), CONFIG.maxQueuePatience * 0.5, CONFIG.maxQueuePatience);
  const timeoutEvent = ctx.schedule('customer:leave-queue', ctx.clock + patienceTime, {
    customerId,
    reason: 'impatient',
  });

  // Store the timeout reference so we can cancel it when service starts
  const customer = ctx.getEntity<CustomerState>(customerId)!;
  customer.state.patienceTimeout = timeoutEvent;

  // Try to assign a free barista
  tryAssignBarista(ctx);

  // Schedule next customer arrival
  const nextArrival = exponentialRandom(ctx.random(), 1 / CONFIG.avgArrivalInterval);
  const nextId = `customer-${ctx.stats.get('totalArrivals').count + 1}`;
  ctx.schedule('customer:arrive', ctx.clock + nextArrival, { customerId: nextId });
});

// --- Customer leaves the queue (impatient) ---
sim.on('customer:leave-queue', (event, ctx) => {
  const { customerId } = event.payload;
  const shop = ctx.getEntity<ShopState>('shop')!;
  const customer = ctx.getEntity<CustomerState>(customerId);

  if (!customer) return; // already served and removed

  // Remove from queue
  const idx = shop.state.queue.indexOf(customerId);
  if (idx !== -1) {
    shop.state.queue.splice(idx, 1);
  }

  const waitTime = ctx.clock - customer.state.arrivedAt;
  ctx.stats.increment('customersLeftQueue');
  ctx.stats.record('waitTimeLeftQueue', waitTime);
  ctx.log('info', `☕ ${customerId} left the queue after ${waitTime.toFixed(1)}min (too long!)`);

  ctx.removeEntity(customerId);
});

// --- Barista starts preparing an order ---
sim.on('barista:start-order', (event, ctx) => {
  const { baristaId, customerId, drink } = event.payload;
  const customer = ctx.getEntity<CustomerState>(customerId);

  if (!customer) return; // customer already left

  // Cancel the patience timeout — they're being served now
  if (customer.state.patienceTimeout) {
    ctx.cancelEvent(customer.state.patienceTimeout);
  }

  const waitTime = ctx.clock - customer.state.arrivedAt;
  ctx.stats.record('waitTimeServed', waitTime);

  const drinkSpec = DRINKS.find((d) => d.name === drink)!;
  const prepTime = uniformRandom(ctx.random(), drinkSpec.prepTime.min, drinkSpec.prepTime.max);

  ctx.log('debug', `${baristaId} starts making ${drink} for ${customerId} (prep: ${prepTime.toFixed(1)}min)`);

  ctx.schedule('barista:finish-order', ctx.clock + prepTime, {
    baristaId,
    customerId,
    drink,
  });
});

// --- Barista finishes an order ---
sim.on('barista:finish-order', (event, ctx) => {
  const { baristaId, customerId, drink } = event.payload;
  const barista = ctx.getEntity<BaristaState>(baristaId)!;
  const customer = ctx.getEntity<CustomerState>(customerId);

  barista.state.busy = false;
  barista.state.ordersCompleted++;

  if (customer) {
    const totalTime = ctx.clock - customer.state.arrivedAt;
    ctx.stats.increment('customersServed');
    ctx.stats.record('totalServiceTime', totalTime);
    ctx.stats.increment(`drinks:${drink}`);
    ctx.log('debug', `${baristaId} finished ${drink} for ${customerId} (total: ${totalTime.toFixed(1)}min)`);
    ctx.removeEntity(customerId);
  }

  // Try to serve next customer in queue
  tryAssignBarista(ctx);
});

// ---------------------------------------------------------------------------
// Helper: assign the next queued customer to a free barista
// ---------------------------------------------------------------------------

function tryAssignBarista(ctx: SimContext<CoffeeShopEvents>): void {
  const shop = ctx.getEntity<ShopState>('shop')!;

  while (shop.state.queue.length > 0) {
    // Find a free barista
    let freeBarista: string | null = null;
    for (let i = 1; i <= CONFIG.numBaristas; i++) {
      const b = ctx.getEntity<BaristaState>(`barista-${i}`)!;
      if (!b.state.busy) {
        freeBarista = b.id;
        break;
      }
    }

    if (!freeBarista) return; // all baristas busy

    const customerId = shop.state.queue.shift()!;
    const customer = ctx.getEntity<CustomerState>(customerId);
    if (!customer) continue; // customer already left

    // Mark barista as busy
    const barista = ctx.getEntity<BaristaState>(freeBarista)!;
    barista.state.busy = true;

    // Schedule order start (immediate — same simulation time)
    ctx.schedule('barista:start-order', ctx.clock, {
      baristaId: freeBarista,
      customerId,
      drink: customer.state.drink,
    });
  }
}

// ---------------------------------------------------------------------------
// Hook: log queue size periodically
// ---------------------------------------------------------------------------

sim.afterEach((_event, ctx) => {
  const shop = ctx.getEntity<ShopState>('shop');
  if (shop) {
    ctx.stats.record('queueLength', shop.state.queue.length);
  }
});

// ---------------------------------------------------------------------------
// Initialize and run
// ---------------------------------------------------------------------------

sim.init((ctx) => {
  // Create the shop entity
  ctx.addEntity<ShopState>({ id: 'shop', state: { queue: [] } });

  // Create barista entities
  for (let i = 1; i <= CONFIG.numBaristas; i++) {
    ctx.addEntity<BaristaState>({
      id: `barista-${i}`,
      state: { busy: false, ordersCompleted: 0 },
    });
  }

  // Schedule first customer
  ctx.schedule('customer:arrive', 0, { customerId: 'customer-1' });
});

// Hook: final report
sim.onEnd((ctx) => {
  console.log('\n' + '='.repeat(60));
  console.log('  COFFEE SHOP SIMULATION REPORT');
  console.log('='.repeat(60));
  console.log(`  Simulation time: ${ctx.clock.toFixed(0)} minutes (${(ctx.clock / 60).toFixed(1)} hours)`);
  console.log();

  const arrivals = ctx.stats.get('totalArrivals');
  const served = ctx.stats.get('customersServed');
  const left = ctx.stats.get('customersLeftQueue');
  const waitServed = ctx.stats.get('waitTimeServed');
  const serviceTime = ctx.stats.get('totalServiceTime');
  const queueLen = ctx.stats.get('queueLength');

  console.log('  CUSTOMERS');
  console.log(`    Total arrivals:      ${arrivals.count}`);
  console.log(`    Served:              ${served.count}`);
  console.log(`    Left (impatient):    ${left.count} (${((left.count / arrivals.count) * 100).toFixed(1)}%)`);
  console.log();

  console.log('  WAIT TIMES (served customers)');
  console.log(`    Average:             ${waitServed.mean.toFixed(2)} min`);
  console.log(`    Min:                 ${waitServed.min.toFixed(2)} min`);
  console.log(`    Max:                 ${waitServed.max.toFixed(2)} min`);
  console.log();

  console.log('  TOTAL SERVICE TIME (wait + prep)');
  console.log(`    Average:             ${serviceTime.mean.toFixed(2)} min`);
  console.log(`    Min:                 ${serviceTime.min.toFixed(2)} min`);
  console.log(`    Max:                 ${serviceTime.max.toFixed(2)} min`);
  console.log();

  console.log('  QUEUE');
  console.log(`    Avg length:          ${queueLen.mean.toFixed(2)}`);
  console.log(`    Max length:          ${queueLen.max}`);
  console.log();

  console.log('  DRINKS SOLD');
  for (const drink of DRINKS) {
    const d = ctx.stats.get(`drinks:${drink.name}`);
    console.log(`    ${drink.name.padEnd(16)} ${d.count}`);
  }

  console.log();
  console.log('  BARISTA PERFORMANCE');
  for (let i = 1; i <= CONFIG.numBaristas; i++) {
    const b = ctx.getEntity<BaristaState>(`barista-${i}`)!;
    console.log(`    barista-${i}:           ${b.state.ordersCompleted} orders`);
  }

  console.log('='.repeat(60));
});

const result = sim.run();

console.log(`\n  Wall clock: ${result.wallClockMs.toFixed(1)}ms`);
console.log(`  Events processed: ${result.totalEventsProcessed}`);
console.log(`  Events cancelled: ${result.totalEventsCancelled}`);
