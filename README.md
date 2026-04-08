# Simloop

[![npm version](https://img.shields.io/npm/v/simloop)](https://www.npmjs.com/package/simloop)
[![license](https://img.shields.io/npm/l/simloop)](./LICENSE)
[![build](https://img.shields.io/github/actions/workflow/status/Mettiu88/simloop/ci.yml?branch=master)](https://github.com/Mettiu88/simloop/actions)
[![npm bundle size](https://img.shields.io/bundlephobia/minzip/simloop)](https://bundlephobia.com/package/simloop)
[![types](https://img.shields.io/npm/types/simloop)](https://www.npmjs.com/package/simloop)

A general-purpose discrete event simulation (DES) framework for Node.js, written in TypeScript.

Simloop provides a minimal, type-safe API for building simulations of real-world systems. You define events, entities, and handlers — the framework runs the event loop.

## Features

- **Type-safe** — generic `TEventMap` gives full autocomplete and type checking on event scheduling and handling
- **Zero runtime dependencies** — only Node.js built-ins
- **Deterministic** — seeded PRNG ensures reproducible results
- **Simple API** — define handlers with `sim.on()`, schedule events with `ctx.schedule()`
- **Probability distributions** — uniform, gaussian, exponential, poisson, bernoulli, zipf, triangular, weibull, lognormal, erlang, geometric
- **Context-bound distributions** — `ctx.dist.exponential(rate)()` eliminates repetitive RNG wiring
- **Warm-up period** — `warmUpTime` option auto-resets statistics after transient phase for steady-state analysis
- **Lifecycle management** — run, pause, resume, stop, reset
- **Built-in statistics** — online mean, variance, min, max, count
- **Pluggable logging** — bring your own logger or use the default console logger
- **Dual module format** — ESM and CJS

## Installation

```bash
npm install simloop
```

## Quick Start

```typescript
import { SimulationEngine } from 'simloop';

// 1. Define your event types
type Events = {
  'customer:arrive': { customerId: string };
  'customer:serve': { customerId: string };
};

// 2. Create the engine
const sim = new SimulationEngine<Events>({ seed: 42, maxTime: 100 });

// 3. Register handlers
sim.on('customer:arrive', (event, ctx) => {
  ctx.stats.increment('arrivals');

  // serve immediately
  ctx.schedule('customer:serve', ctx.clock + 2, {
    customerId: event.payload.customerId,
  });

  // schedule next arrival (exponential inter-arrival, mean = 5)
  const nextArrival = ctx.dist.exponential(0.2)();
  ctx.schedule('customer:arrive', ctx.clock + nextArrival, {
    customerId: `C${ctx.stats.get('arrivals').count + 1}`,
  });
});

sim.on('customer:serve', (event, ctx) => {
  ctx.stats.increment('served');
});

// 4. Initialize and run
sim.init((ctx) => {
  ctx.schedule('customer:arrive', 0, { customerId: 'C1' });
});

const result = sim.run();
console.log(result.stats);
```

## Core Concepts

### Events

Events are timestamped actions with a type tag and a payload. The `TEventMap` generic maps each event type to its payload shape:

```typescript
type MyEvents = {
  'order:placed': { orderId: string; items: number };
  'order:completed': { orderId: string };
};
```

### Entities

Entities are stateful objects that participate in the simulation. They have a unique `id` and a generic `state`:

```typescript
ctx.addEntity({ id: 'server-1', state: { busy: false, processed: 0 } });

const server = ctx.getEntity<{ busy: boolean; processed: number }>('server-1');
server!.state.busy = true;
```

### Simulation Context

Every handler receives a `SimContext` with:

| Method | Description |
|---|---|
| `ctx.clock` | Current simulation time |
| `ctx.schedule(type, time, payload)` | Schedule a new event |
| `ctx.cancelEvent(event)` | Cancel a scheduled event |
| `ctx.getEntity(id)` | Get an entity by ID |
| `ctx.addEntity(entity)` | Add an entity |
| `ctx.removeEntity(id)` | Remove an entity |
| `ctx.store` | Global simulation store (typed as `TStore`) |
| `ctx.stats` | Statistics collector (numeric metrics) |
| `ctx.random()` | Seeded random number (0-1) |
| `ctx.dist` | Context-bound distribution helper (see below) |
| `ctx.warmUpCompleted` | Whether the warm-up period has ended |
| `ctx.log(level, message)` | Log a message |

### Global Store

The store is a typed, persistent object for accumulating custom data across handlers and hooks. Initialize it via `options.store` and access it as `ctx.store`. It's returned in `SimulationResult` and restored to its initial value on `reset()`.

```typescript
type Events = { tick: { value: number } };
type Store  = { count: number; total: number };

const sim = new SimulationEngine<Events, Store>({
  store: { count: 0, total: 0 },
});

sim.on('tick', (event, ctx) => {
  ctx.store.count++;
  ctx.store.total += event.payload.value;
});

const result = sim.run();
console.log(result.store); // { count: ..., total: ... }
```

### Event Cancellation

`schedule()` returns the event object. Pass it to `cancelEvent()` to prevent it from being processed:

```typescript
const timeout = ctx.schedule('timeout', ctx.clock + 10, {});
// later...
ctx.cancelEvent(timeout);
```

### Lifecycle Hooks

```typescript
sim.beforeEach((event, ctx) => { /* before each event */ });
sim.afterEach((event, ctx) => { /* after each event */ });
sim.onEnd((ctx) => { /* when simulation finishes */ });
```

## Configuration

```typescript
const sim = new SimulationEngine<Events, Store>({
  seed: 42,            // PRNG seed (default: Date.now())
  maxTime: 1000,       // stop at this simulation time (default: Infinity)
  maxEvents: 5000,     // stop after N events (default: Infinity)
  logLevel: 'info',    // 'debug' | 'info' | 'warn' | 'error' | 'silent'
  name: 'MySim',       // log prefix (default: 'Simulation')
  realTimeDelay: 100,  // ms delay between events in runAsync (default: 0)
  warmUpTime: 500,     // reset stats after this sim-time (default: undefined)
  store: { ... },      // initial global store value (default: {})
});
```

## Simulation Result

`run()` returns a `SimulationResult`:

```typescript
const result = sim.run();

result.totalEventsProcessed  // number of events handled
result.totalEventsCancelled  // number of cancelled events skipped
result.finalClock            // final simulation time
result.wallClockMs           // real-world execution time in ms
result.stats                 // Record<string, StatsSummary>
result.status                // 'finished' | 'stopped' | 'maxTimeReached' | 'maxEventsReached'
result.store                 // TStore — final state of the global store
```

## Async Execution

For long simulations that shouldn't block the Node.js event loop:

```typescript
const result = await sim.runAsync();
```

## Resource

`Resource` implements the seize/delay/release pattern for capacity-constrained shared resources — the building block of M/M/c queueing models (servers, machines, staff, connections).

```typescript
import { SimulationEngine, Resource } from 'simloop';

type Events = {
  'job:arrive': { jobId: number };
  'job:done':   Record<string, never>;
};

const sim = new SimulationEngine<Events>({ seed: 42 });
const server = new Resource<Events>('server'); // capacity defaults to 1

sim.on('job:arrive', (event, ctx) => {
  const arrivalTime = ctx.clock;

  // SEIZE — callback fires when a slot is free (immediately or after queuing)
  server.request(ctx, (ctx) => {
    ctx.stats.record('waitTime', ctx.clock - arrivalTime);
    ctx.schedule('job:done', ctx.clock + ctx.dist.exponential(1)(), {});
  });

  ctx.schedule('job:arrive', ctx.clock + ctx.dist.exponential(0.8)(), {
    jobId: event.payload.jobId + 1,
  });
});

sim.on('job:done', (_e, ctx) => {
  server.release(ctx); // RELEASE — automatically grants next queued request
});
```

Auto-collected statistics: `resource.{name}.waitTime`, `queueLength`, `utilization`, `requests`, `grants`.

For the full API — priority queuing, cancellation, edge cases, and M/M/c examples — see [docs/resource-spec.md](docs/resource-spec.md).

## Examples

See the [examples/](examples/) directory:

- **[store-counter](examples/store-counter/)** — minimal example showing `ctx.store` usage
- **[coffee-shop](examples/coffee-shop/)** — multi-barista coffee shop with customer patience, drink types, and queue management
- **[network-packets](examples/network-packets/)** — network router simulation using all six probability distributions

```bash
npm run example:store-counter
npm run example:coffee-shop
npm run example:network-packets
```

## Probability Distributions

Simloop includes common probability distributions. Inside handlers, use `ctx.dist` which pre-binds `ctx.random()` to all distribution factories:

```typescript
sim.on('customer:arrive', (event, ctx) => {
  const nextArrival = ctx.dist.exponential(0.5)();
  const serviceTime = ctx.dist.gaussian(10, 2)();

  ctx.schedule('customer:arrive', ctx.clock + nextArrival, { ... });
});
```

Standalone factory functions are also exported for use outside of handlers or with a custom RNG:

```typescript
import { exponential, SeededRandom } from 'simloop';

const rng = new SeededRandom(42);
const sampler = exponential(() => rng.next(), 0.5);
console.log(sampler()); // sample from exponential
```

| Distribution | Factory | Description |
|---|---|---|
| Uniform | `uniform(rng, a, b)` | Continuous on `[a, b)` |
| Gaussian | `gaussian(rng, mean?, stddev?)` | Normal via Box-Muller (default: standard normal) |
| Exponential | `exponential(rng, rate)` | Rate λ, mean = 1/λ |
| Poisson | `poisson(rng, lambda)` | Non-negative integers, mean = λ |
| Bernoulli | `bernoulli(rng, p)` | Returns 1 with probability p, 0 otherwise |
| Zipf | `zipf(rng, n, s)` | Ranks `[1, n]`, probability ∝ 1/k^s |
| Triangular | `triangular(rng, min, mode, max)` | Three-point estimate; useful when only min/mode/max are known |
| Weibull | `weibull(rng, scale, shape)` | Reliability and failure analysis; shape controls failure rate regime |
| Lognormal | `lognormal(rng, mu?, sigma?)` | Right-skewed; models service times, repair durations, response times |
| Erlang | `erlang(rng, k, rate)` | Sum of k exponentials; models k-stage sequential processes |
| Geometric | `geometric(rng, p)` | Trials until first success; minimum value is 1 |

## API Reference

### Exported Classes

- `SimulationEngine<TEventMap, TStore>` — main simulation engine
- `Resource<TEventMap, TStore>` — seize/delay/release primitive for shared resources
- `SimulationError` — error thrown for invalid operations
- `ConsoleLogger` — default logger implementation
- `DefaultStatsCollector` — default statistics collector
- `SeededRandom` — Mulberry32 PRNG

### Exported Distribution Functions

- `createDistHelper(rng)` — creates a `DistributionHelper` with a custom RNG (used internally by `ctx.dist`)
- `uniform(rng, a, b)` — continuous uniform
- `gaussian(rng, mean?, stddev?)` — normal (Box-Muller)
- `exponential(rng, rate)` — exponential
- `poisson(rng, lambda)` — Poisson (Knuth)
- `bernoulli(rng, p)` — Bernoulli
- `zipf(rng, n, s)` — Zipf
- `triangular(rng, min, mode, max)` — triangular
- `weibull(rng, scale, shape)` — Weibull
- `lognormal(rng, mu?, sigma?)` — lognormal
- `erlang(rng, k, rate)` — Erlang
- `geometric(rng, p)` — geometric

### Exported Types

- `SimEvent<TType, TPayload>` — simulation event
- `SimEntity<TState>` — simulation entity
- `SimContext<TEventMap, TStore>` — handler context
- `EventHandler<TEventMap, TType, TStore>` — handler function signature
- `SimulationResult<TStore>` — run result
- `SimulationEngineOptions<TStore>` — engine configuration
- `ResourceOptions` / `RequestOptions` / `RequestHandle` / `ResourceSnapshot` — Resource types
- `StatsCollector` / `StatsSummary` — statistics interfaces
- `DistributionHelper` — interface for the `ctx.dist` object
- `SimLogger` / `LogLevel` — logging interfaces
- `SimulationStatus` / `SimulationEndStatus` — lifecycle types

## License

MIT
