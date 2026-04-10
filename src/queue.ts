import type { SimContext } from './types.js';
import { SimulationError } from './engine.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface QueueOptions {
  /** Maximum number of items. Default: Infinity (unbounded) */
  maxCapacity?: number;
  /** What happens when enqueue is called on a full queue. Default: 'drop' */
  overflowPolicy?: 'drop' | 'block';
  /** Prefix for all auto-collected stat keys. Default: queue name */
  statsPrefix?: string;
}

export interface EnqueueOptions {
  /** Lower value = higher precedence. Ties broken by arrival order (FIFO). Default: 0 */
  priority?: number;
}

export interface QueueSnapshot<T> {
  name: string;
  maxCapacity: number;
  length: number;
  items: readonly T[];
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface QueueEntry<T> {
  readonly item: T;
  readonly enqueuedAt: number;
  readonly priority: number;
  readonly insertionOrder: number;
}

interface BlockedEntry<T> {
  readonly item: T;
  readonly blockedAt: number;
  readonly priority: number;
  readonly insertionOrder: number;
}

// ---------------------------------------------------------------------------
// Queue class
// ---------------------------------------------------------------------------

/**
 * A standalone FIFO/priority queue with optional bounded capacity, overflow
 * policies (drop/block), and auto-collected statistics.
 *
 * Unlike `Resource` (seize/delay/release for capacity-constrained servers),
 * `Queue` models buffers, pipelines, conveyor belts, and WIP limits.
 *
 * @example
 * ```ts
 * const buffer = new Queue<string>('buffer', { maxCapacity: 10 });
 *
 * sim.on('item:produce', (event, ctx) => {
 *   buffer.enqueue(ctx, event.payload.itemId);
 * });
 *
 * sim.on('item:consume', (_event, ctx) => {
 *   const item = buffer.dequeue(ctx);
 *   if (item !== undefined) { ... }
 * });
 * ```
 */
export class Queue<T> {
  readonly name: string;
  readonly maxCapacity: number;
  readonly overflowPolicy: 'drop' | 'block';

  private readonly _statsPrefix: string;
  private readonly _items: QueueEntry<T>[] = [];
  private readonly _blocked: BlockedEntry<T>[] = [];
  private _insertionCounter = 0;

  constructor(name: string, options: QueueOptions = {}) {
    const maxCapacity = options.maxCapacity ?? Infinity;
    if (maxCapacity <= 0) {
      throw new SimulationError(`Queue '${name}': maxCapacity must be > 0, got ${maxCapacity}`);
    }
    this.name = name;
    this.maxCapacity = maxCapacity;
    this.overflowPolicy = options.overflowPolicy ?? 'drop';
    this._statsPrefix = options.statsPrefix ?? name;
  }

  // ---------------------------------------------------------------------------
  // Accessors
  // ---------------------------------------------------------------------------

  /** Current number of items in the queue */
  get length(): number {
    return this._items.length;
  }

  /** True when length >= maxCapacity */
  get isFull(): boolean {
    return this._items.length >= this.maxCapacity;
  }

  /** True when length === 0 */
  get isEmpty(): boolean {
    return this._items.length === 0;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Add an item to the queue.
   *
   * - If the queue is not full, the item is inserted in priority order (FIFO
   *   within the same priority).
   * - If the queue is full and `overflowPolicy` is `'drop'`, returns `false`
   *   and the item is discarded.
   * - If the queue is full and `overflowPolicy` is `'block'`, the item is held
   *   in a waiting list and automatically admitted when `dequeue()` frees a slot.
   *
   * @returns `true` if the item was enqueued, `false` if dropped or blocked.
   */
  enqueue<TEventMap extends Record<string, unknown>, TStore>(ctx: SimContext<TEventMap, TStore>, item: T, options: EnqueueOptions = {}): boolean {
    const prefix = this._statsPrefix;
    const priority = options.priority ?? 0;
    const insertionOrder = ++this._insertionCounter;

    if (this._items.length < this.maxCapacity) {
      this._insertSorted({ item, enqueuedAt: ctx.clock, priority, insertionOrder });
      ctx.stats.increment(`queue.${prefix}.enqueued`);
      ctx.stats.record(`queue.${prefix}.queueLength`, this._items.length);
      return true;
    }

    if (this.overflowPolicy === 'drop') {
      ctx.stats.increment(`queue.${prefix}.dropped`);
      return false;
    }

    // block
    this._blocked.push({ item, blockedAt: ctx.clock, priority, insertionOrder });
    ctx.stats.increment(`queue.${prefix}.blocked`);
    return false;
  }

  /**
   * Remove and return the highest-priority (or oldest) item from the queue.
   *
   * If blocked items are waiting and the dequeue frees a slot, the oldest
   * blocked item is automatically admitted.
   *
   * @returns The item, or `undefined` if the queue is empty.
   */
  dequeue<TEventMap extends Record<string, unknown>, TStore>(ctx: SimContext<TEventMap, TStore>): T | undefined {
    if (this._items.length === 0) return undefined;

    const entry = this._items.shift()!;
    const prefix = this._statsPrefix;

    ctx.stats.increment(`queue.${prefix}.dequeued`);
    ctx.stats.increment(`queue.${prefix}.throughput`);
    ctx.stats.record(`queue.${prefix}.waitTime`, ctx.clock - entry.enqueuedAt);
    ctx.stats.record(`queue.${prefix}.queueLength`, this._items.length);

    // Admit oldest blocked item if space is available
    if (this._blocked.length > 0 && this._items.length < this.maxCapacity) {
      const blocked = this._blocked.shift()!;
      const blockTime = ctx.clock - blocked.blockedAt;
      ctx.stats.record(`queue.${prefix}.blockTime`, blockTime);

      this._insertSorted({
        item: blocked.item,
        enqueuedAt: ctx.clock,
        priority: blocked.priority,
        insertionOrder: blocked.insertionOrder,
      });
      ctx.stats.increment(`queue.${prefix}.enqueued`);
      ctx.stats.record(`queue.${prefix}.queueLength`, this._items.length);
    }

    return entry.item;
  }

  /**
   * Look at the front item without removing it.
   *
   * @returns The item, or `undefined` if the queue is empty.
   */
  peek(): T | undefined {
    return this._items.length > 0 ? this._items[0].item : undefined;
  }

  /**
   * Return a plain snapshot of the queue's current state.
   */
  snapshot(): QueueSnapshot<T> {
    return {
      name: this.name,
      maxCapacity: this.maxCapacity,
      length: this._items.length,
      items: this._items.map((e) => e.item),
    };
  }

  /**
   * Reset internal state. Call after engine.reset() before re-running.
   */
  reset(): void {
    this._items.length = 0;
    this._blocked.length = 0;
    this._insertionCounter = 0;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Insert entry maintaining sort order: (priority ASC, insertionOrder ASC) */
  private _insertSorted(entry: QueueEntry<T>): void {
    let i = this._items.length;
    while (
      i > 0 &&
      (this._items[i - 1].priority > entry.priority ||
        (this._items[i - 1].priority === entry.priority &&
          this._items[i - 1].insertionOrder > entry.insertionOrder))
    ) {
      i--;
    }
    this._items.splice(i, 0, entry);
  }
}
