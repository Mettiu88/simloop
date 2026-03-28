/**
 * Network Packet Processing Simulation
 *
 * Simulates a network router handling incoming packets with:
 * - Packet arrivals following a Poisson process (exponential inter-arrivals)
 * - Packet sizes drawn from a Zipf distribution (few large, many small)
 * - Processing time drawn from a Gaussian distribution
 * - Random packet drops modeled with a Bernoulli distribution
 * - Jitter (delay variation) drawn from a uniform distribution
 *
 * Demonstrates: all six probability distributions working together
 * in a realistic simulation scenario.
 */

import { SimulationEngine } from '../../src/index.js';
import type { SimContext } from '../../src/index.js';
import { exponential, zipf, gaussian, bernoulli, uniform } from '../../src/distributions/index.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CONFIG = {
  seed: 2024,
  maxTime: 1000,             // simulation time units
  avgArrivalRate: 5,         // packets per time unit (Poisson process)
  packetSizeRanks: 5,        // number of distinct packet size categories
  zipfExponent: 1.5,         // how skewed the size distribution is
  meanProcessTime: 1.2,      // mean processing time per packet
  processTimeStddev: 0.3,    // stddev of processing time
  dropProbability: 0.02,     // 2% packet drop rate
  jitterMin: 0.0,            // minimum added jitter
  jitterMax: 0.5,            // maximum added jitter
};

const PACKET_SIZES = [64, 256, 512, 1024, 1500]; // bytes per rank

// ---------------------------------------------------------------------------
// Event map
// ---------------------------------------------------------------------------

type NetworkEvents = {
  'packet:arrive': { packetId: string; sizeBytes: number };
  'packet:process': { packetId: string; sizeBytes: number };
  'packet:done': { packetId: string; sizeBytes: number };
  'packet:drop': { packetId: string; sizeBytes: number; reason: string };
};

// ---------------------------------------------------------------------------
// Entity state
// ---------------------------------------------------------------------------

interface RouterState {
  queue: string[];
  processing: boolean;
  totalBytes: number;
}

// ---------------------------------------------------------------------------
// Simulation setup
// ---------------------------------------------------------------------------

const sim = new SimulationEngine<NetworkEvents>({
  seed: CONFIG.seed,
  maxTime: CONFIG.maxTime,
  logLevel: 'info',
  name: 'NetworkRouter',
});

// Create distribution samplers (will be initialized in init)
let nextArrival: () => number;
let packetSizeRank: () => number;
let processTime: () => number;
let shouldDrop: () => number;
let jitter: () => number;

// --- Packet arrives at the router ---
sim.on('packet:arrive', (event, ctx) => {
  const { packetId, sizeBytes } = event.payload;
  const router = ctx.getEntity<RouterState>('router')!;

  ctx.stats.increment('arrivals');
  ctx.stats.record('packetSize', sizeBytes);

  // Check for random drop (congestion, corruption, etc.)
  if (shouldDrop() === 1) {
    ctx.stats.increment('dropped');
    ctx.log('debug', `${packetId} DROPPED (${sizeBytes}B)`);
    ctx.schedule('packet:drop', ctx.clock, { packetId, sizeBytes, reason: 'random' });
  } else {
    // Enqueue for processing
    router.state.queue.push(packetId);
    ctx.log('debug', `${packetId} queued (${sizeBytes}B, queue: ${router.state.queue.length})`);

    // If router is idle, start processing immediately
    if (!router.state.processing) {
      tryProcessNext(ctx);
    }
  }

  // Schedule next packet arrival
  const arrivalDelay = nextArrival();
  const rank = packetSizeRank();
  const nextSize = PACKET_SIZES[rank - 1];
  const nextId = `pkt-${ctx.stats.get('arrivals').count + 1}`;
  ctx.schedule('packet:arrive', ctx.clock + arrivalDelay, {
    packetId: nextId,
    sizeBytes: nextSize,
  });
});

// --- Router starts processing a packet ---
sim.on('packet:process', (event, ctx) => {
  const { packetId, sizeBytes } = event.payload;
  const router = ctx.getEntity<RouterState>('router')!;
  router.state.processing = true;

  // Processing time: Gaussian base + uniform jitter
  const baseTime = Math.max(0.1, processTime());
  const addedJitter = jitter();
  const totalTime = baseTime + addedJitter;

  ctx.stats.record('processTime', totalTime);

  ctx.log('debug', `Processing ${packetId} (${sizeBytes}B, est: ${totalTime.toFixed(2)})`);

  ctx.schedule('packet:done', ctx.clock + totalTime, { packetId, sizeBytes });
});

// --- Packet processing complete ---
sim.on('packet:done', (event, ctx) => {
  const { packetId, sizeBytes } = event.payload;
  const router = ctx.getEntity<RouterState>('router')!;

  router.state.processing = false;
  router.state.totalBytes += sizeBytes;

  ctx.stats.increment('processed');
  ctx.stats.record('throughputBytes', sizeBytes);
  ctx.log('debug', `${packetId} done (${sizeBytes}B)`);

  // Process next packet in queue
  tryProcessNext(ctx);
});

// --- Packet dropped ---
sim.on('packet:drop', (_event, _ctx) => {
  // Just a marker event for tracing; stats already recorded on arrival
});

// ---------------------------------------------------------------------------
// Helper: process the next queued packet
// ---------------------------------------------------------------------------

function tryProcessNext(ctx: SimContext<NetworkEvents>): void {
  const router = ctx.getEntity<RouterState>('router')!;

  if (router.state.queue.length === 0) return;
  if (router.state.processing) return;

  const packetId = router.state.queue.shift()!;
  const rank = packetSizeRank();
  const sizeBytes = PACKET_SIZES[rank - 1];

  ctx.schedule('packet:process', ctx.clock, { packetId, sizeBytes });
}

// ---------------------------------------------------------------------------
// Initialize and run
// ---------------------------------------------------------------------------

sim.init((ctx) => {
  // Initialize distribution samplers using the simulation's PRNG
  const rng = () => ctx.random();
  nextArrival = exponential(rng, CONFIG.avgArrivalRate);
  packetSizeRank = zipf(rng, CONFIG.packetSizeRanks, CONFIG.zipfExponent);
  processTime = gaussian(rng, CONFIG.meanProcessTime, CONFIG.processTimeStddev);
  shouldDrop = bernoulli(rng, CONFIG.dropProbability);
  jitter = uniform(rng, CONFIG.jitterMin, CONFIG.jitterMax);

  // Create router entity
  ctx.addEntity<RouterState>({
    id: 'router',
    state: { queue: [], processing: false, totalBytes: 0 },
  });

  // Schedule first packet
  const firstRank = packetSizeRank();
  ctx.schedule('packet:arrive', 0, {
    packetId: 'pkt-1',
    sizeBytes: PACKET_SIZES[firstRank - 1],
  });
});

// Final report
sim.onEnd((ctx) => {
  const router = ctx.getEntity<RouterState>('router')!;
  const arrivals = ctx.stats.get('arrivals');
  const processed = ctx.stats.get('processed');
  const dropped = ctx.stats.get('dropped');
  const pktSize = ctx.stats.get('packetSize');
  const procTime = ctx.stats.get('processTime');

  console.log('\n' + '='.repeat(60));
  console.log('  NETWORK ROUTER SIMULATION REPORT');
  console.log('='.repeat(60));
  console.log(`  Simulation time: ${ctx.clock.toFixed(1)} time units`);
  console.log();

  console.log('  TRAFFIC');
  console.log(`    Total arrivals:      ${arrivals.count}`);
  console.log(`    Processed:           ${processed.count}`);
  console.log(`    Dropped:             ${dropped.count} (${((dropped.count / arrivals.count) * 100).toFixed(1)}%)`);
  console.log(`    Total throughput:    ${(router.state.totalBytes / 1024).toFixed(1)} KB`);
  console.log();

  console.log('  PACKET SIZES');
  console.log(`    Average:             ${pktSize.mean.toFixed(0)} bytes`);
  console.log(`    Min:                 ${pktSize.min} bytes`);
  console.log(`    Max:                 ${pktSize.max} bytes`);
  console.log();

  console.log('  PROCESSING TIME');
  console.log(`    Average:             ${procTime.mean.toFixed(3)} time units`);
  console.log(`    Std dev:             ${Math.sqrt(procTime.variance).toFixed(3)} time units`);
  console.log(`    Min:                 ${procTime.min.toFixed(3)}`);
  console.log(`    Max:                 ${procTime.max.toFixed(3)}`);
  console.log();

  console.log('  DISTRIBUTIONS USED');
  console.log(`    Arrivals:            Exponential(rate=${CONFIG.avgArrivalRate})`);
  console.log(`    Packet sizes:        Zipf(n=${CONFIG.packetSizeRanks}, s=${CONFIG.zipfExponent})`);
  console.log(`    Processing time:     Gaussian(μ=${CONFIG.meanProcessTime}, σ=${CONFIG.processTimeStddev})`);
  console.log(`    Drop decision:       Bernoulli(p=${CONFIG.dropProbability})`);
  console.log(`    Jitter:              Uniform(${CONFIG.jitterMin}, ${CONFIG.jitterMax})`);
  console.log('='.repeat(60));
});

const result = sim.run();

console.log(`\n  Wall clock: ${result.wallClockMs.toFixed(1)}ms`);
console.log(`  Events processed: ${result.totalEventsProcessed}`);
console.log(`  Events cancelled: ${result.totalEventsCancelled}`);
