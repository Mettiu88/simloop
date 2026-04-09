# Simloop — Functional Requirements

## 1. Project Overview

**Simloop** is a general-purpose discrete event simulation (DES) framework for Node.js, written in TypeScript.

### Goals

- Provide a minimal, type-safe API for building discrete event simulations
- Zero mandatory runtime dependencies — only Node.js built-ins
- TypeScript-first design: generics, discriminated unions, interfaces
- Easy to learn: a basic simulation (e.g., single-server queue) should take under 50 lines
- Extensible via composition (handlers, hooks, custom loggers), not deep inheritance hierarchies

### Tech Stack

- **Language**: TypeScript (strict mode, target ES2022+, Node 18+)
- **Runtime**: Node.js
- **Package manager**: npm
- **Module format**: ESM primary, CJS fallback via `exports` field
- **Test framework**: `vitest` or `node:test`

---

## 2. Core Concepts

| Concept              | Description |
|----------------------|-------------|
| **Simulation Clock** | A logical clock (`number`, representing arbitrary time units). Advances discretely to the timestamp of the next event. Never moves backward. |
| **Event**            | A timestamped action to be executed. Carries a `time`, a `type` (string tag), and a generic `payload`. |
| **Event Queue**      | A min-heap priority queue ordered by `(time, insertionOrder)`. The insertion-order tiebreaker guarantees deterministic behavior for simultaneous events. |
| **Entity**           | A stateful object participating in the simulation. Has a unique `id` and user-defined state. |
| **Store**            | A single typed object (`TStore`) that lives for the duration of the simulation run. Accessible as `ctx.store` in all handlers and hooks. Returned in `SimulationResult`. Reset to its initial value on `reset()`. |
| **Simulation Context** | The object passed to event handlers. Provides access to the clock, entity registry, event-scheduling API, statistics, logger, and store. |
| **Simulation Engine** | The orchestrator. Owns the clock, queue, entity registry, store, and lifecycle. Runs the main event loop. |

---

## 3. API Surface

### 3.1 `SimEvent<TType, TPayload>`

```typescript
interface SimEvent<TType extends string = string, TPayload = unknown> {
  readonly id: string;           // auto-generated unique ID
  readonly time: number;         // scheduled simulation time
  readonly type: TType;          // event type tag (discriminated union key)
  readonly payload: TPayload;    // user-defined event data
  readonly createdAt: number;    // simulation time when the event was scheduled
  cancelled: boolean;            // set to true to skip processing
}
```

### 3.2 `SimEntity<TState>`

```typescript
interface SimEntity<TState = unknown> {
  readonly id: string;
  state: TState;
}
```

Minimal by design. Users define their own state shape via the generic parameter.

### 3.3 `SimContext<TEventMap, TStore>`

The context object passed to every event handler. `TEventMap` is a record mapping event type strings to their payload types. `TStore` is the shape of the global simulation store (defaults to `Record<string, unknown>`).

```typescript
interface SimContext<TEventMap extends Record<string, unknown>, TStore = Record<string, unknown>> {
  /** Current simulation time */
  readonly clock: number;

  /** Schedule a new event. Returns the event object (can be used for cancellation). */
  schedule<K extends keyof TEventMap & string>(
    type: K,
    time: number,
    payload: TEventMap[K]
  ): SimEvent<K, TEventMap[K]>;

  /** Cancel a previously scheduled event */
  cancelEvent(event: SimEvent): void;

  /** Entity registry */
  getEntity<T>(id: string): SimEntity<T> | undefined;
  addEntity<T>(entity: SimEntity<T>): void;
  removeEntity(id: string): void;
  getAllEntities(): ReadonlyArray<SimEntity>;

  /** Statistics collector (numeric metrics only) */
  stats: StatsCollector;

  /** Global simulation store — typed, mutable, persists for the full run */
  store: TStore;

  /** Logging */
  log(level: LogLevel, message: string, data?: unknown): void;

  /** Seeded pseudo-random number generator (0-1 range) */
  random(): number;

  /** Context-bound distribution helper — pre-binds random() to all distribution factories */
  dist: DistributionHelper;

  /** Whether the warm-up period has completed (always true if no warmUpTime is set) */
  readonly warmUpCompleted: boolean;
}
```

### 3.4 `EventHandler<TEventMap, TType, TStore>`

```typescript
type EventHandler<
  TEventMap extends Record<string, unknown>,
  TType extends keyof TEventMap & string,
  TStore = Record<string, unknown>
> = (event: SimEvent<TType, TEventMap[TType]>, ctx: SimContext<TEventMap, TStore>) => void;
```

Handlers are pure functions. Side effects happen only through `ctx`. This makes handlers independently testable.

### 3.5 `SimulationEngine<TEventMap, TStore>`

The main class that users instantiate and configure.

```typescript
class SimulationEngine<TEventMap extends Record<string, unknown>, TStore = Record<string, unknown>> {
  constructor(options?: SimulationEngineOptions<TEventMap, TStore>);

  /** Register a handler for an event type */
  on<K extends keyof TEventMap & string>(
    type: K,
    handler: EventHandler<TEventMap, K, TStore>
  ): this;

  /** Set up initial entities and events */
  init(setup: (ctx: SimContext<TEventMap, TStore>) => void): this;

  /** Run the simulation (synchronous) */
  run(): SimulationResult<TStore>;

  /** Run the simulation (async — yields to Node.js event loop periodically) */
  runAsync(): Promise<SimulationResult<TStore>>;

  /** Pause the simulation (can be resumed) */
  pause(): void;

  /** Resume a paused simulation */
  resume(): void;

  /** Stop the simulation (terminal — cannot be resumed) */
  stop(): void;

  /** Reset to idle state: clears clock, queue, entities, stats, store. Handlers and hooks are preserved. */
  reset(): void;

  /** Lifecycle hooks */
  beforeEach(hook: (event: SimEvent, ctx: SimContext<TEventMap, TStore>) => void): this;
  afterEach(hook: (event: SimEvent, ctx: SimContext<TEventMap, TStore>) => void): this;
  onEnd(hook: (ctx: SimContext<TEventMap, TStore>) => void): this;

  /** Read-only state */
  readonly clock: number;
  readonly eventsProcessed: number;
  readonly eventsQueued: number;
  readonly status: SimulationStatus;
}

type SimulationStatus = 'idle' | 'running' | 'paused' | 'stopped' | 'finished';
```

### 3.6 `StatsCollector` and `StatsSummary`

```typescript
interface StatsCollector {
  /** Record a numeric observation */
  record(name: string, value: number): void;

  /** Increment a counter */
  increment(name: string, by?: number): void;

  /** Get summary for a named metric */
  get(name: string): StatsSummary;

  /** Get all recorded metrics */
  getAll(): Record<string, StatsSummary>;

  /** Reset all metrics */
  reset(): void;
}

interface StatsSummary {
  count: number;
  sum: number;
  min: number;
  max: number;
  mean: number;
  variance: number;
}
```

### 3.7 `SimLogger`

```typescript
type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

interface SimLogger {
  log(level: LogLevel, clock: number, message: string, data?: unknown): void;
}
```

Default implementation writes to `console` with format: `[SIM t=123.45] [INFO] message`.

### 3.8 `SimulationResult<TStore>`

```typescript
interface SimulationResult<TStore = Record<string, unknown>> {
  readonly totalEventsProcessed: number;
  readonly totalEventsCancelled: number;
  readonly finalClock: number;
  readonly wallClockMs: number;
  readonly stats: Record<string, StatsSummary>;
  readonly status: 'finished' | 'stopped' | 'maxTimeReached' | 'maxEventsReached' | 'stopConditionMet';
  readonly store: TStore;
}
```

### 3.9 Configuration

```typescript
interface SimulationEngineOptions<
  TEventMap extends Record<string, unknown> = Record<string, unknown>,
  TStore = Record<string, unknown>,
> {
  /** PRNG seed for reproducibility. Default: Date.now() */
  seed?: number;

  /** Stop when simulation clock reaches this value. Default: Infinity */
  maxTime?: number;

  /** Stop after processing this many events. Default: Infinity */
  maxEvents?: number;

  /** Minimum log level. Default: 'info' */
  logLevel?: LogLevel;

  /** Custom logger implementation. Default: ConsoleLogger */
  logger?: SimLogger;

  /** Simulation name (used in log prefixes). Default: 'Simulation' */
  name?: string;

  /** Delay in ms between events in runAsync (for visualization/debugging). Default: 0 */
  realTimeDelay?: number;

  /** Warm-up time: stats are automatically reset when the clock crosses this threshold.
   *  Useful for discarding transient initial bias and collecting steady-state statistics.
   *  Default: undefined (no warm-up). */
  warmUpTime?: number;

  /** Custom stop condition evaluated after each processed event. When it returns `true`
   *  the simulation ends with status `'stopConditionMet'`.
   *  Useful for optimisation, steady-state detection, and Monte Carlo convergence.
   *  Default: undefined (no custom stop condition). */
  stopWhen?: (ctx: SimContext<TEventMap, TStore>) => boolean;

  /** Initial value for the global simulation store. Deep-cloned on init and on reset(). Default: {} */
  store?: TStore;
}
```

---

## 4. Event Processing Model

### 4.1 Priority Queue

The internal event queue is a binary min-heap sorted by:
1. `time` (ascending)
2. `insertionOrder` (ascending, FIFO — ensures determinism for simultaneous events)

### 4.2 Main Loop Algorithm

```
while queue is not empty
  AND clock < maxTime
  AND eventsProcessed < maxEvents
  AND status !== 'stopped':

    event = queue.dequeueMin()

    if event.cancelled:
        increment cancelledCount
        continue

    clock = event.time
    run all beforeEach hooks
    handler = handlers[event.type]

    if handler exists:
        handler(event, context)
    else:
        log warning: unhandled event type

    run all afterEach hooks
    increment processedCount

    if stopWhen is defined AND stopWhen(context) is true:
        mark stopConditionMet
        break

run all onEnd hooks
return SimulationResult
```

### 4.3 Dynamic Scheduling

Handlers can call `ctx.schedule()` to insert new events during processing. Constraint: the scheduled event's `time` must be `>= ctx.clock`. Scheduling an event in the past throws a `SimulationError`.

### 4.4 Event Cancellation

`ctx.cancelEvent(event)` sets the event's `cancelled` flag to `true`. The event remains in the queue but is skipped during processing (lazy deletion). This avoids the cost of removing from the heap.

---

## 5. Simulation Lifecycle

```
          init()          run()
  [idle] -------> [idle] -------> [running]
                                   |   |   \
                             pause()|  |stop() \---> [finished]
                                   v   v               (natural end)
                              [paused] [stopped]
                                |         |
                          resume()|   reset()|
                                |         v
                          [running]    [idle]
```

| State      | Allowed transitions                          | Description |
|------------|----------------------------------------------|-------------|
| `idle`     | `init()` → `idle`, `run()` → `running`       | Initial state. Call `init()` to seed entities and first events. |
| `running`  | `pause()` → `paused`, `stop()` → `stopped`, natural end → `finished` | Main loop executing. |
| `paused`   | `resume()` → `running`, `stop()` → `stopped` | Loop suspended, full state preserved. |
| `stopped`  | `reset()` → `idle`                            | Terminal. Cannot resume. |
| `finished` | `reset()` → `idle`                            | Natural termination (queue empty or limit reached). |

---

## 6. State Management

- **Entity Registry**: Internal `Map<string, SimEntity>`. Entities are added/removed via `SimContext` methods.
- **Global Store**: A single `TStore` object initialized from `options.store`, accessible as `ctx.store` in all handlers and hooks, and returned in `SimulationResult.store`. The initial value is deep-cloned via `structuredClone`, so `reset()` always restores the exact original state. Mutations happen in-place — no proxy or Immer wrapper.
- **No imposed structure**: The framework does not enforce any schema on entity state or store shape — that is the user's domain.
- **Immutability recommendation**: Users should treat `event.payload` as readonly. TypeScript's `Readonly<T>` can be used in the `TEventMap` generic for enforcement.

---

## 7. Logging and Observability

- **Log levels**: `debug`, `info`, `warn`, `error`, `silent`
- **Built-in logging**: The engine logs lifecycle transitions and event processing at `debug` level
- **User logging**: Handlers call `ctx.log()` for application-level logging
- **Pluggable logger**: Users can provide a custom `SimLogger` via `options.logger` to redirect output (files, structured logging, etc.)
- **Hooks**: `beforeEach` / `afterEach` for tracing and metrics; `onEnd` for final reports

---

## 8. Non-Functional Requirements

- **Zero runtime dependencies**: Priority queue, PRNG, and stats collector are implemented internally using only Node.js built-ins.
- **Determinism**: Given the same seed and initial conditions, a simulation must produce identical results. No use of `Date.now()` or `Math.random()` in the engine internals.
- **Performance**: Binary heap for the event queue. Target: 1M+ events/second for trivial handlers.
- **Extensibility**: Users extend behavior through composition (handlers, hooks, custom loggers), not class inheritance.
- **Testing**: The framework ships with unit tests covering: event ordering, cancellation, lifecycle transitions, PRNG determinism, and stats accuracy.
- **Package format**: Single entry point, ESM primary with CJS fallback.

---

## 9. Probability Distributions

Simloop ships a set of common probability distributions as composable factory functions. Each factory takes a `rng: () => number` source (typically `ctx.random` or `SeededRandom.next`) and the distribution parameters, and returns a `() => number` sampler.

This design keeps distributions decoupled from the engine — they can be used standalone with any `[0, 1)` source (including `Math.random`).

### 9.1 Available Distributions

| Distribution | Factory signature | Description |
|---|---|---|
| **Uniform** | `uniform(rng, a, b)` | Continuous uniform on `[a, b)` |
| **Gaussian** | `gaussian(rng, mean?, stddev?)` | Normal distribution via Box-Muller transform. Defaults to standard normal (μ=0, σ=1) |
| **Exponential** | `exponential(rng, rate)` | Exponential with rate λ. Mean = 1/λ |
| **Poisson** | `poisson(rng, lambda)` | Poisson via Knuth's algorithm. Returns non-negative integers |
| **Bernoulli** | `bernoulli(rng, p)` | Returns 1 with probability p, 0 otherwise |
| **Zipf** | `zipf(rng, n, s)` | Zipf over ranks `[1, n]` with exponent s. Rank k has probability ∝ 1/k^s |
| **Triangular** | `triangular(rng, min, mode, max)` | Triangular distribution; three-point estimate (PERT, expert estimates) |
| **Weibull** | `weibull(rng, scale, shape)` | Weibull distribution; reliability and failure analysis |
| **Lognormal** | `lognormal(rng, mu?, sigma?)` | Lognormal distribution; right-skewed service times, response times |
| **Erlang** | `erlang(rng, k, rate)` | Erlang distribution; sum of k exponentials, k-stage sequential processes |
| **Geometric** | `geometric(rng, p)` | Geometric distribution; number of trials until first success (minimum 1) |

### 9.2 Usage

```typescript
import { SeededRandom } from 'simloop';
import { exponential, gaussian } from 'simloop/distributions';

const prng = new SeededRandom(42);
const rng = () => prng.next();

const interArrival = exponential(rng, 0.5);   // mean = 2
const serviceTime  = gaussian(rng, 10, 2);    // mean = 10, stddev = 2

console.log(interArrival()); // sample from exponential
console.log(serviceTime());  // sample from gaussian
```

### 9.3 Context-bound distributions (`ctx.dist`)

Inside event handlers, `ctx.dist` provides all distribution factories with `ctx.random()` pre-bound, eliminating the need to pass the RNG manually:

```typescript
sim.on('customer:arrive', (event, ctx) => {
  const nextArrival = ctx.dist.exponential(0.5)();
  ctx.schedule('customer:arrive', ctx.clock + nextArrival, { ... });

  // Or create a reusable sampler
  const serviceTime = ctx.dist.gaussian(10, 2);
  console.log(serviceTime()); // sample from gaussian
});
```

Each method on `ctx.dist` mirrors its standalone counterpart (minus the `rng` parameter) and returns a `() => number` sampler.

The standalone functions remain available for use outside of event handlers or with a custom RNG source.

### 9.4 Validation

All factories validate their parameters and throw `RangeError` for invalid inputs (e.g., negative rate, `p` outside `[0, 1]`).

---

## 10. Out of Scope (v1)

- **GUI / Visualization**: No built-in charts or dashboards. Users consume `SimulationResult` in external tools.
- **Distributed / parallel execution**: Single-threaded, single-process.
- **Real-time simulation**: The clock is logical. `realTimeDelay` is a convenience for demos, not a real-time guarantee.
- **Continuous simulation**: No time-stepping or differential equation solvers.
- **Domain-specific models**: No built-in queuing theory, network, or other domain models.
- **Persistence**: No built-in save-to-disk or database integration.

---

## 11. Example: M/M/1 Queue

A minimal single-server queue simulation demonstrating the full API:

```typescript
import { SimulationEngine } from 'simloop';

// Define event types and their payloads
type Events = {
  'customer:arrive': { customerId: string };
  'customer:startService': { customerId: string };
  'customer:endService': { customerId: string };
};

const sim = new SimulationEngine<Events>({ seed: 42, maxTime: 1000 });

// Handle customer arrivals
sim.on('customer:arrive', (event, ctx) => {
  const { customerId } = event.payload;
  ctx.stats.increment('arrivals');

  // Add customer entity to the queue
  ctx.addEntity({ id: customerId, state: { arrivedAt: ctx.clock } });

  // Schedule next arrival (exponential inter-arrival time)
  const nextId = `C${ctx.stats.get('arrivals').count + 1}`;
  ctx.schedule('customer:arrive', ctx.clock + ctx.dist.exponential(1.0)(), {
    customerId: nextId,
  });

  // If server is free, start service immediately
  const server = ctx.getEntity<{ busy: boolean }>('server');
  if (server && !server.state.busy) {
    ctx.schedule('customer:startService', ctx.clock, { customerId });
  }
});

// Handle service start
sim.on('customer:startService', (event, ctx) => {
  const server = ctx.getEntity<{ busy: boolean }>('server')!;
  server.state.busy = true;

  // Schedule service completion (exponential service time)
  ctx.schedule('customer:endService', ctx.clock + ctx.dist.exponential(1.5)(), {
    customerId: event.payload.customerId,
  });
});

// Handle service end
sim.on('customer:endService', (event, ctx) => {
  const server = ctx.getEntity<{ busy: boolean }>('server')!;
  server.state.busy = false;

  const customer = ctx.getEntity<{ arrivedAt: number }>(event.payload.customerId);
  if (customer) {
    ctx.stats.record('waitTime', ctx.clock - customer.state.arrivedAt);
    ctx.removeEntity(customer.id);
  }

  ctx.stats.increment('served');
});

// Initialize
sim.init((ctx) => {
  ctx.addEntity({ id: 'server', state: { busy: false } });
  ctx.schedule('customer:arrive', 0, { customerId: 'C1' });
});

// Run
const result = sim.run();
console.log(`Served: ${result.stats['served']?.count}`);
console.log(`Avg wait: ${result.stats['waitTime']?.mean.toFixed(2)}`);
console.log(`Sim time: ${result.finalClock.toFixed(2)}`);
```
