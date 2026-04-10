# Queue — simloop primitive

## 1. Overview

### Problem

Many simulations need to model buffers, pipelines, conveyor belts, and work-in-progress (WIP) limits. These are fundamentally different from `Resource` (which models capacity-constrained servers with seize/delay/release) — a `Queue` holds **items** that flow through the system.

### Queue vs Resource

| | Queue | Resource |
|---|---|---|
| **Models** | Buffers, pipelines, WIP limits | Servers, machines, staff |
| **Pattern** | enqueue item → wait → dequeue item | seize slot → delay → release slot |
| **Items** | Typed values (`Queue<T>`) | Anonymous slots |
| **Capacity** | Bounded or unbounded | Always bounded (>= 1) |
| **Overflow** | Drop or block | Always queues |

### Reference

- GPSS QUEUE/DEPART blocks
- SimPy Store/FilterStore
- Arena QUEUE module

---

## 2. Quick Start

### Bounded buffer (drop on overflow)

```ts
import { SimulationEngine, Queue } from 'simloop';

type Events = {
  'item:produce': { itemId: number };
  'item:consume': Record<string, never>;
};

const sim = new SimulationEngine<Events>({ seed: 42, maxTime: 100 });
const buffer = new Queue<number>('buffer', { maxCapacity: 5 });

sim.on('item:produce', (event, ctx) => {
  const accepted = buffer.enqueue(ctx, event.payload.itemId);
  if (!accepted) ctx.log('warn', `Item ${event.payload.itemId} dropped`);

  ctx.schedule('item:produce', ctx.clock + ctx.dist.exponential(1)(), {
    itemId: event.payload.itemId + 1,
  });
});

sim.on('item:consume', (_e, ctx) => {
  const item = buffer.dequeue(ctx);
  if (item !== undefined) ctx.stats.increment('consumed');
  ctx.schedule('item:consume', ctx.clock + ctx.dist.exponential(0.8)(), {});
});

sim.init((ctx) => {
  ctx.schedule('item:produce', 0, { itemId: 1 });
  ctx.schedule('item:consume', 1, {});
});

const result = sim.run();
console.log('Consumed:', result.stats['consumed']?.count);
console.log('Dropped:', result.stats['queue.buffer.dropped']?.count ?? 0);
console.log('Avg wait:', result.stats['queue.buffer.waitTime']?.mean.toFixed(2));
```

### Unbounded queue (default)

```ts
const pipeline = new Queue<string>('pipeline'); // maxCapacity = Infinity
```

### Blocking buffer

```ts
const belt = new Queue<number>('belt', { maxCapacity: 10, overflowPolicy: 'block' });
// Items blocked when full are automatically admitted when dequeue() frees a slot
```

---

## 3. API Reference

### `new Queue(name, options?)`

```ts
const queue = new Queue<T>(name: string, options?: QueueOptions);
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxCapacity` | `number` | `Infinity` | Maximum number of items. Must be > 0. |
| `overflowPolicy` | `'drop' \| 'block'` | `'drop'` | Behaviour when enqueueing to a full queue. |
| `statsPrefix` | `string` | `name` | Prefix for all auto-collected stat keys. |

Throws `SimulationError` if `maxCapacity <= 0`.

---

### `queue.enqueue(ctx, item, options?)`

```ts
const accepted = queue.enqueue(ctx, item, { priority: 0 });
```

- If the queue has space: the item is inserted in priority order and returns `true`.
- If the queue is full and `overflowPolicy` is `'drop'`: returns `false`, item is discarded.
- If the queue is full and `overflowPolicy` is `'block'`: returns `false`, item is held in a waiting list and automatically admitted when `dequeue()` frees a slot.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `priority` | `number` | `0` | Lower value = higher precedence. Ties broken by arrival order (FIFO). |

---

### `queue.dequeue(ctx)`

```ts
const item = queue.dequeue(ctx); // T | undefined
```

Removes and returns the front item (highest-priority, or oldest for same priority).

Returns `undefined` if the queue is empty.

If blocked items are waiting and the dequeue frees a slot, the oldest blocked item is automatically admitted.

---

### `queue.peek()`

```ts
const item = queue.peek(); // T | undefined
```

Returns the front item without removing it. Does not record any stats.

---

### `queue.snapshot()`

```ts
const snap = queue.snapshot();
// { name, maxCapacity, length, items: readonly T[] }
```

Returns a plain object with the current state. Useful for logging and assertions.

---

### `queue.reset()`

```ts
queue.reset();
```

Clears all items, blocked entries, and the insertion counter. **Must be called after `engine.reset()`** before re-running the simulation.

---

### Accessors

| Accessor | Type | Description |
|----------|------|-------------|
| `queue.name` | `string` | Name given at construction |
| `queue.maxCapacity` | `number` | Maximum capacity |
| `queue.overflowPolicy` | `'drop' \| 'block'` | Overflow behaviour |
| `queue.length` | `number` | Current number of items |
| `queue.isFull` | `boolean` | `length >= maxCapacity` |
| `queue.isEmpty` | `boolean` | `length === 0` |

---

## 4. Overflow Policies

### Drop (default)

When the queue is full, `enqueue()` returns `false` and the item is silently discarded. The `queue.{name}.dropped` counter is incremented.

Use this for systems where items can be lost (e.g., network packet buffers, production lines with no backpressure).

### Block

When the queue is full, the item is held in an internal waiting list. When `dequeue()` removes an item and frees a slot, the oldest blocked item is automatically admitted to the queue. The `queue.{name}.blocked` counter is incremented on block, and `queue.{name}.blockTime` records the time from block to admission.

Use this for systems with backpressure (e.g., conveyor belts, bounded producer-consumer).

---

## 5. Statistics Reference

All stat keys are prefixed with `queue.{statsPrefix}.` (default: `queue.{name}.`).

| Key | Collected via | Description |
|-----|---------------|-------------|
| `queue.{n}.enqueued` | `stats.increment` | Total successful enqueue operations |
| `queue.{n}.dequeued` | `stats.increment` | Total successful dequeue operations |
| `queue.{n}.throughput` | `stats.increment` | Alias for dequeued (useful for throughput reporting) |
| `queue.{n}.dropped` | `stats.increment` | Items discarded due to overflow (policy='drop') |
| `queue.{n}.blocked` | `stats.increment` | Items blocked waiting for space (policy='block') |
| `queue.{n}.blockTime` | `stats.record` | Time from block to admission |
| `queue.{n}.waitTime` | `stats.record` | Time from enqueue to dequeue per item |
| `queue.{n}.queueLength` | `stats.record` | Queue depth snapshot after each enqueue/dequeue |

**Reading stats from `SimulationResult`:**

```ts
const result = sim.run();
const wt = result.stats['queue.buffer.waitTime'];
console.log(`Mean wait: ${wt.mean.toFixed(2)}, max: ${wt.max.toFixed(2)}`);

const dropped = result.stats['queue.buffer.dropped']?.count ?? 0;
console.log(`Drop rate: ${(dropped / total * 100).toFixed(1)}%`);
```

---

## 6. Priority Queuing

By default, all items have `priority = 0` and are served in FIFO order.

```ts
queue.enqueue(ctx, item, { priority: 1 });  // high priority
queue.enqueue(ctx, item, { priority: 10 }); // low priority
```

Within the same priority level, items are served in the order `enqueue()` was called (FIFO). The insertion counter is internal and never resets until `queue.reset()`.

**Negative priorities are allowed.** Priority is a plain `number`; the minimum value wins.

---

## 7. Edge Cases

### 7.1 Dequeue from empty queue

Returns `undefined`. No stats are recorded.

### 7.2 `maxCapacity = Infinity` (default)

The queue is never full — `isFull` always returns `false`, `overflowPolicy` is irrelevant.

### 7.3 Queue state after `engine.reset()`

Like `Resource`, `Queue` is external to the engine. After resetting, call `queue.reset()` before the next run:

```ts
sim.run();
sim.reset();
queue.reset(); // ← required
sim.init((ctx) => { /* re-init */ });
sim.run();
```

### 7.4 Multiple queues with the same name

Stats will be recorded under the same prefix and will be merged — producing incorrect statistics. Names (or `statsPrefix` values) must be unique per simulation instance.

---

## 8. Full Example: Production Line Buffer

See the full annotated source: [examples/queue-buffer/main.ts](../examples/queue-buffer/main.ts)
