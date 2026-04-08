# Resource — simloop primitive

## 1. Overview

### Problem

Every queueing simulation needs to model resources with limited capacity: servers, machines, staff, connections. Without a built-in primitive, each simulation must reimplement the same logic: a wait queue, slot tracking, request assignment, and utilization statistics.

### The seize / delay / release cycle

The `Resource` primitive encodes the canonical pattern from queueing theory:

```
ARRIVE → SEIZE resource → DELAY (use) → RELEASE → DEPART
         ↑                                   |
         └── if full: QUEUE → wait ──────────┘
```

This maps directly to M/M/c and related models (Kendall notation: A/S/c/K/N/D).

### Theoretical background

- **Banks et al., "Discrete-Event System Simulation" (5th ed.)** — Chapter 4 formalises seize/delay/release
- **Erlang (1909)** — origin of queueing theory and the M/M/c model
- **Little's Law** (`L = λW`) — relates throughput, queue length, and wait time; the stats collected by Resource feed directly into this analysis

### Scope

`Resource` covers:
- Single and multi-server pools (M/M/1, M/M/c)
- Priority queuing (FIFO within priority level)
- Cancellation of waiting requests
- Auto-collection of wait time, queue length, utilization

`Resource` does **not** cover:
- Preemption (evicting a current holder) — see §8
- Stores with distinct items (different from a capacity pool)
- Continuous containers (tanks, buffers with levels)

---

## 2. Quick Start

### M/M/1 single-server queue

```ts
import { SimulationEngine, Resource } from 'simloop';

type Events = {
  'job:arrive': { jobId: number };
  'job:done':   Record<string, never>;
};

const sim = new SimulationEngine<Events>({ seed: 42 });
const server = new Resource<Events>('server'); // capacity defaults to 1

let jobCounter = 0;

sim.on('job:arrive', (event, ctx) => {
  const arrivalTime = ctx.clock;
  const interArrival = ctx.dist.exponential(0.8)();
  ctx.schedule('job:arrive', ctx.clock + interArrival, { jobId: ++jobCounter });

  server.request(ctx, (ctx) => {
    const waitTime = ctx.clock - arrivalTime;
    ctx.stats.record('waitTime', waitTime);

    const serviceTime = ctx.dist.exponential(1.0)();
    ctx.schedule('job:done', ctx.clock + serviceTime, {});
  });
});

sim.on('job:done', (_e, ctx) => {
  server.release(ctx);
});

sim.init((ctx) => {
  ctx.schedule('job:arrive', 0, { jobId: ++jobCounter });
});

const result = sim.run({ maxEvents: 10_000 });
console.log('Mean wait:', result.stats['resource.server.waitTime'].mean);
// M/M/1 theory: Wq = ρ/(μ−λ) = 0.8/(1.0−0.8) = 4.0
```

### M/M/c multi-server queue

```ts
const baristas = new Resource<Events>('baristas', { capacity: 3 });

// SEIZE (inside customer:arrive handler)
baristas.request(ctx, (ctx) => {
  ctx.schedule('order:done', ctx.clock + prepTime, { customerId });
});

// RELEASE (inside order:done handler)
baristas.release(ctx);
```

---

## 3. API Reference

### `new Resource(name, options?)`

```ts
const resource = new Resource<TEventMap, TStore>(name: string, options?: ResourceOptions);
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `capacity` | `number` | `1` | Number of concurrent slots. Must be >= 1. |
| `statsPrefix` | `string` | `name` | Prefix for all auto-collected stat keys. |

Throws `SimulationError` if `capacity <= 0`.

---

### `resource.request(ctx, cb, opts?)`

```ts
const handle = resource.request(ctx, (ctx) => {
  // called when slot is acquired
  resource.release(ctx); // or schedule an event that later calls release()
}, { priority: 0 });
```

- If a slot is free: `cb` is called immediately (same sim-time, synchronously within the current handler).
- If all slots are busy: the request is queued and `cb` fires when another holder calls `release()`.

`cb` receives the current `ctx` at the time of acquisition (which may be later than request time if queued).

**Returns** a `RequestHandle` that can be passed to `cancel()`.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `priority` | `number` | `0` | Lower value = higher precedence. Ties broken by arrival order (FIFO). |

---

### `resource.release(ctx)`

```ts
resource.release(ctx);
```

Decrements `inUse` and immediately grants the next pending request in the queue (if any).

Throws `SimulationError` if `inUse === 0` (no slot is currently held).

**Call this exactly once per acquired slot.** Forgetting to call `release()` keeps the slot seized permanently — subsequent queued requests will never be served.

---

### `resource.cancel(handle)`

```ts
const cancelled = resource.cancel(handle); // true if removed from queue
```

Cancels a pending (not yet granted) request.

- Returns `true` if the request was in the queue and was removed.
- Returns `false` if the request was already granted or not found.

Sets `handle.cancelled = true` in both cases.

---

### `resource.snapshot()`

```ts
const snap = resource.snapshot();
// { name, capacity, inUse, queueLength }
```

Returns a plain object with the current state. Useful for logging and assertions.

---

### `resource.reset()`

```ts
resource.reset();
```

Clears `inUse`, the wait queue, and the request counter. **Must be called after `engine.reset()`** before re-running the simulation. See §7.4.

---

### Accessors

| Accessor | Type | Description |
|----------|------|-------------|
| `resource.name` | `string` | Name given at construction |
| `resource.capacity` | `number` | Total slot count |
| `resource.inUse` | `number` | Currently occupied slots |
| `resource.queueLength` | `number` | Requests waiting |
| `resource.isAvailable` | `boolean` | `inUse < capacity` |

---

## 4. Statistics Reference

All stat keys are prefixed with `resource.{statsPrefix}.` (default: `resource.{name}.`).

| Key | Collected via | Description |
|-----|---------------|-------------|
| `resource.{n}.waitTime` | `stats.record` | Time between `request()` and callback invocation. `0` for immediate grants. |
| `resource.{n}.queueLength` | `stats.record` | Queue depth snapshot after each enqueue or drain. |
| `resource.{n}.utilization` | `stats.record` | `inUse / capacity` at each state change. |
| `resource.{n}.requests` | `stats.increment` | Total calls to `request()`. |
| `resource.{n}.grants` | `stats.increment` | Total successful acquisitions (immediate + from queue). |

**Reading stats from `SimulationResult`:**

```ts
const result = sim.run();
const wt = result.stats['resource.server.waitTime'];
console.log(`Mean wait: ${wt.mean.toFixed(2)}, max: ${wt.max.toFixed(2)}`);

const util = result.stats['resource.server.utilization'];
console.log(`Mean utilization: ${(util.mean * 100).toFixed(1)}%`);
```

**Utilization caveat:** `utilization.mean` is the arithmetic mean of sampled values at each state change, not a time-weighted average. For exact time-average utilization (needed for rigorous Little's Law verification), use a `beforeEach` hook to record `(inUse / capacity) * timeSinceLastChange` manually. For most analysis purposes the arithmetic mean is a good approximation.

---

## 5. Priority Queue Behaviour

By default, all requests have `priority = 0` and are served in FIFO order.

```ts
// Lower priority number = served first
resource.request(ctx, cb, { priority: 1 });  // high priority
resource.request(ctx, cb, { priority: 10 }); // low priority
```

Within the same priority level, requests are served in the order `request()` was called (FIFO). The insertion counter is internal and never resets until `resource.reset()`.

**Negative priorities are allowed.** Priority is a plain `number`; the minimum value wins.

---

## 6. Cancellation

### Patience timeout pattern

The most common use case — cancel a waiting request when a customer loses patience:

```ts
sim.on('customer:arrive', (event, ctx) => {
  const { customerId } = event.payload;

  const handle = baristas.request(ctx, (ctx) => {
    // served — cancel the timeout (may already be fired, which is fine)
    if (timeoutEvent) ctx.cancelEvent(timeoutEvent);
    // do work ...
  });

  // schedule patience timeout
  const timeoutEvent = ctx.schedule('customer:leave', ctx.clock + patience, { customerId });

  sim.on('customer:leave', (event, ctx) => {
    baristas.cancel(handle); // withdraw from queue; returns false if already served
    ctx.removeEntity(customerId);
  });
});
```

### What `cancel()` does NOT do

- It **cannot revoke an already-granted slot**. Once `cb` has been called, the request is considered active and the caller must call `release()`.
- It does not affect other requests in the queue.

---

## 7. Edge Cases and Gotchas

### 7.1 Forgetting to call `release()`

The slot remains seized indefinitely. `inUse` never drops, queued requests wait forever, and `utilization` stays at 1.0. This is the Resource equivalent of a memory leak — always ensure `release()` is reachable from every code path inside the callback.

```ts
// WRONG — if db call throws, release never happens (not applicable in DES
// since handlers are synchronous, but logic errors can skip release)
resource.request(ctx, (ctx) => {
  if (condition) return; // BUG: release() never called
  ctx.schedule('done', ctx.clock + 1, {});
});

// CORRECT — release always reachable
resource.request(ctx, (ctx) => {
  if (condition) {
    resource.release(ctx); // explicit early release
    return;
  }
  ctx.schedule('done', ctx.clock + 1, {});
});
```

### 7.2 `capacity = Infinity` (M/M/∞ model)

All requests are granted immediately — no queuing ever occurs. Useful for infinite-server queues where each customer always finds a free server.

```ts
const infiniteServers = new Resource('pool', { capacity: Infinity });
```

### 7.3 Calling `release()` twice (double-release)

The second call throws `SimulationError: release() called but no slot is currently held`. This surfaces double-release bugs immediately during development.

### 7.4 Resource state after `engine.reset()`

`engine.reset()` clears the engine's clock, queue, entities, and stats — but **not** the `Resource` instance, which is external to the engine. After resetting, call `resource.reset()` before the next `sim.init()` / `sim.run()` cycle:

```ts
sim.run();
// ...
sim.reset();
resource.reset(); // ← required
sim.init((ctx) => { /* re-init */ });
sim.run();
```

### 7.5 Multiple resources with the same name

Stats will be recorded under the same prefix and will be merged — producing incorrect statistics for both resources. Names (or `statsPrefix` values) must be unique per simulation instance.

---

## 8. Preemption (Out of Scope)

Preemption means forcibly evicting a current slot holder in favour of a higher-priority request. `Resource` does not support this directly — there is no mechanism to interrupt a granted callback.

**Workaround using event cancellation:** The current holder can listen for a "preempt" event (scheduled by the high-priority requester) and voluntarily call `release()` early, then re-request at a lower priority. This requires coordination in the domain logic.

A future `PreemptiveResource` subclass could implement this pattern cleanly. The `Resource` API is designed to be extended via subclassing.

---

## 9. Full Example: Coffee Shop Rewrite

The original coffee-shop example reimplements resource management manually (~100 lines for barista tracking + queue). With `Resource` this collapses to the callback pattern — eliminating `BaristaState` entities, the `ShopState` queue entity, the `tryAssignBarista()` helper, and the `barista:start-order` / `barista:finish-order` event types (~150 lines saved).

See the full annotated source: [examples/coffee-shop/main.ts](../examples/coffee-shop/main.ts)
