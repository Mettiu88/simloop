/**
 * Coffee Shop Simulation — rewritten with Resource
 *
 * A discrete event simulation of a coffee shop with:
 * - Customers arriving at random intervals
 * - Multiple baristas managed via the Resource primitive
 * - Different drink types with different preparation times
 * - Customer patience: if not served in time, they leave
 *
 * Demonstrates: Resource (seize/delay/release), event cancellation,
 * entity management, statistics collection, and lifecycle hooks.
 */

import { SimulationEngine, Resource } from '../../src/index.js';
import type { SimEvent, RequestHandle } from '../../src/index.js';

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

type DrinkType = 'espresso' | 'cappuccino' | 'latte' | 'cold-brew';

interface DrinkSpec {
  name: DrinkType;
  prepTime: { min: number; max: number }; // minutes
  popularity: number;                     // relative weight for random selection
}

const DRINKS: DrinkSpec[] = [
  { name: 'espresso',   prepTime: { min: 1,   max: 2   }, popularity: 4 },
  { name: 'cappuccino', prepTime: { min: 2,   max: 4   }, popularity: 3 },
  { name: 'latte',      prepTime: { min: 2.5, max: 4.5 }, popularity: 2 },
  { name: 'cold-brew',  prepTime: { min: 0.5, max: 1.5 }, popularity: 1 },
];

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CONFIG = {
  numBaristas: 2,
  avgArrivalInterval: 2.5, // avg minutes between customers
  maxQueuePatience: 8,     // minutes a customer is willing to wait
  simulationDuration: 480, // 8-hour shift in minutes
  seed: 12345,
};

// ---------------------------------------------------------------------------
// Event map
// ---------------------------------------------------------------------------

type CoffeeShopEvents = {
  'customer:arrive': { customerId: string };
  'customer:leave':  { customerId: string };
  'order:complete':  { customerId: string; drink: DrinkType };
};

// ---------------------------------------------------------------------------
// Entity state
// ---------------------------------------------------------------------------

interface CustomerState {
  arrivedAt: number;
  drink: DrinkType;
  baristaHandle: RequestHandle | null;   // for cancellation if customer leaves
  patienceTimeout: SimEvent | null;      // for cancellation when service starts
}

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

function pickDrink(u: number): DrinkSpec {
  const total = DRINKS.reduce((s, d) => s + d.popularity, 0);
  let t = u * total;
  for (const d of DRINKS) {
    t -= d.popularity;
    if (t <= 0) return d;
  }
  return DRINKS[DRINKS.length - 1];
}

// ---------------------------------------------------------------------------
// Simulation setup
// ---------------------------------------------------------------------------

interface CoffeeShopStore {
  customersInService: number;
}

const sim = new SimulationEngine<CoffeeShopEvents, CoffeeShopStore>({
  seed: CONFIG.seed,
  maxTime: CONFIG.simulationDuration,
  logLevel: 'info',
  name: 'CoffeeShop',
  store: { customersInService: 0 },
});

// The Resource replaces: BaristaState entities, ShopState queue entity,
// and the tryAssignBarista() helper function.
const baristas = new Resource<CoffeeShopEvents, CoffeeShopStore>('baristas', {
  capacity: CONFIG.numBaristas,
});

// --- Customer arrives ---
sim.on('customer:arrive', (event, ctx) => {
  const { customerId } = event.payload;
  const drink = pickDrink(ctx.random());

  ctx.stats.increment('totalArrivals');
  ctx.log('debug', `${customerId} arrives, wants a ${drink.name}`);

  ctx.addEntity<CustomerState>({
    id: customerId,
    state: { arrivedAt: ctx.clock, drink: drink.name, baristaHandle: null, patienceTimeout: null },
  });

  // Patience timeout — customer leaves if not served in time
  const patience = ctx.dist.uniform(CONFIG.maxQueuePatience * 0.5, CONFIG.maxQueuePatience)();
  const patienceTimeout = ctx.schedule('customer:leave', ctx.clock + patience, { customerId });
  ctx.getEntity<CustomerState>(customerId)!.state.patienceTimeout = patienceTimeout;

  // SEIZE barista — callback fires when a barista is free
  const handle = baristas.request(ctx, (ctx) => {
    const customer = ctx.getEntity<CustomerState>(customerId);

    if (!customer) {
      // Customer left the queue before a barista became free
      baristas.release(ctx);
      return;
    }

    // Cancel patience timeout — being served now
    if (customer.state.patienceTimeout) {
      ctx.cancelEvent(customer.state.patienceTimeout);
    }

    ctx.store.customersInService++;

    const waitTime = ctx.clock - customer.state.arrivedAt;
    ctx.stats.record('waitTimeServed', waitTime);
    ctx.log('debug', `${customerId} starts service after ${waitTime.toFixed(1)}min wait`);

    const drinkSpec = DRINKS.find(d => d.name === customer.state.drink)!;
    const prepTime = ctx.dist.uniform(drinkSpec.prepTime.min, drinkSpec.prepTime.max)();

    ctx.schedule('order:complete', ctx.clock + prepTime, {
      customerId,
      drink: customer.state.drink,
    });
  });

  ctx.getEntity<CustomerState>(customerId)!.state.baristaHandle = handle;

  // Schedule next customer arrival
  const nextArrival = ctx.dist.exponential(1 / CONFIG.avgArrivalInterval)();
  const nextId = `customer-${ctx.stats.get('totalArrivals').count + 1}`;
  ctx.schedule('customer:arrive', ctx.clock + nextArrival, { customerId: nextId });
});

// --- Customer leaves (impatient) ---
sim.on('customer:leave', (event, ctx) => {
  const { customerId } = event.payload;
  const customer = ctx.getEntity<CustomerState>(customerId);

  if (!customer) return; // already served and removed

  const waitTime = ctx.clock - customer.state.arrivedAt;
  ctx.stats.increment('customersLeftQueue');
  ctx.stats.record('waitTimeLeftQueue', waitTime);
  ctx.log('info', `${customerId} left the queue after ${waitTime.toFixed(1)}min (too long!)`);

  // Withdraw from barista queue if still waiting
  if (customer.state.baristaHandle) {
    baristas.cancel(customer.state.baristaHandle);
  }

  ctx.removeEntity(customerId);
});

// --- Order complete ---
sim.on('order:complete', (event, ctx) => {
  const { customerId, drink } = event.payload;
  const customer = ctx.getEntity<CustomerState>(customerId);

  // RELEASE barista — automatically triggers next queued customer
  baristas.release(ctx);

  if (customer) {
    ctx.store.customersInService--;
    const totalTime = ctx.clock - customer.state.arrivedAt;
    ctx.stats.increment('customersServed');
    ctx.stats.record('totalServiceTime', totalTime);
    ctx.stats.increment(`drinks:${drink}`);
    ctx.log('debug', `${customerId} done (total: ${totalTime.toFixed(1)}min)`);
    ctx.removeEntity(customerId);
  }
});

// ---------------------------------------------------------------------------
// Initialize and run
// ---------------------------------------------------------------------------

sim.init((ctx) => {
  ctx.schedule('customer:arrive', 0, { customerId: 'customer-1' });
});

sim.onEnd((ctx) => {
  console.log('\n' + '='.repeat(60));
  console.log('  COFFEE SHOP SIMULATION REPORT');
  console.log('='.repeat(60));
  console.log(`  Simulation time: ${ctx.clock.toFixed(0)} minutes (${(ctx.clock / 60).toFixed(1)} hours)`);
  console.log();

  const arrivals    = ctx.stats.get('totalArrivals');
  const served      = ctx.stats.get('customersServed');
  const left        = ctx.stats.get('customersLeftQueue');
  const waitServed  = ctx.stats.get('waitTimeServed');
  const serviceTime = ctx.stats.get('totalServiceTime');
  const util        = ctx.stats.get('resource.baristas.utilization');
  const queueLen    = ctx.stats.get('resource.baristas.queueLength');

  console.log('  CUSTOMERS');
  console.log(`    Total arrivals:      ${arrivals.count}`);
  console.log(`    Served:              ${served.count}`);
  console.log(`    Left (impatient):    ${left.count} (${((left.count / arrivals.count) * 100).toFixed(1)}%)`);
  if (ctx.store.customersInService > 0) {
    console.log(`    In service at end:   ${ctx.store.customersInService}`);
  }
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

  console.log('  BARISTAS (via Resource)');
  console.log(`    Utilization (mean):  ${(util.mean * 100).toFixed(1)}%`);
  console.log(`    Queue avg length:    ${queueLen.mean.toFixed(2)}`);
  console.log(`    Queue max length:    ${queueLen.max}`);
  console.log(`    Total requests:      ${ctx.stats.get('resource.baristas.requests').count}`);
  console.log(`    Total grants:        ${ctx.stats.get('resource.baristas.grants').count}`);
  console.log();

  console.log('  DRINKS SOLD');
  for (const drink of DRINKS) {
    const d = ctx.stats.get(`drinks:${drink.name}`);
    console.log(`    ${drink.name.padEnd(16)} ${d.count}`);
  }

  console.log('='.repeat(60));
});

const result = sim.run();

console.log(`\n  Wall clock: ${result.wallClockMs.toFixed(1)}ms`);
console.log(`  Events processed: ${result.totalEventsProcessed}`);
console.log(`  Events cancelled: ${result.totalEventsCancelled}`);
