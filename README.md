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

  // schedule next arrival
  const interval = -Math.log(1 - ctx.random()) * 5;
  ctx.schedule('customer:arrive', ctx.clock + interval, {
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
| `ctx.stats` | Statistics collector |
| `ctx.random()` | Seeded random number (0-1) |
| `ctx.log(level, message)` | Log a message |

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
const sim = new SimulationEngine<Events>({
  seed: 42,           // PRNG seed (default: Date.now())
  maxTime: 1000,      // stop at this simulation time (default: Infinity)
  maxEvents: 5000,    // stop after N events (default: Infinity)
  logLevel: 'info',   // 'debug' | 'info' | 'warn' | 'error' | 'silent'
  name: 'MySim',      // log prefix (default: 'Simulation')
  realTimeDelay: 100,  // ms delay between events in runAsync (default: 0)
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
```

## Async Execution

For long simulations that shouldn't block the Node.js event loop:

```typescript
const result = await sim.runAsync();
```

## Examples

See the [examples/](examples/) directory:

- **[coffee-shop](examples/coffee-shop/)** — multi-barista coffee shop with customer patience, drink types, and queue management

```bash
npm run example:coffee-shop
```

## API Reference

### Exported Classes

- `SimulationEngine<TEventMap>` — main simulation engine
- `SimulationError` — error thrown for invalid operations
- `ConsoleLogger` — default logger implementation
- `DefaultStatsCollector` — default statistics collector
- `SeededRandom` — Mulberry32 PRNG

### Exported Types

- `SimEvent<TType, TPayload>` — simulation event
- `SimEntity<TState>` — simulation entity
- `SimContext<TEventMap>` — handler context
- `EventHandler<TEventMap, TType>` — handler function signature
- `SimulationResult` — run result
- `SimulationEngineOptions` — engine configuration
- `StatsCollector` / `StatsSummary` — statistics interfaces
- `SimLogger` / `LogLevel` — logging interfaces
- `SimulationStatus` / `SimulationEndStatus` — lifecycle types

## License

MIT
