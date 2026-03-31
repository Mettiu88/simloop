import type { SimContext } from './types.js';
import { SimulationError } from './engine.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ResourceOptions {
  /** Number of concurrent slots. Default: 1 */
  capacity?: number;
  /** Prefix for all auto-collected stat keys. Default: resource name */
  statsPrefix?: string;
}

export interface RequestOptions {
  /** Lower value = higher precedence. Ties broken by arrival order (FIFO). Default: 0 */
  priority?: number;
}

export interface RequestHandle {
  readonly id: string;
  /** True after cancel() has been called on this handle */
  cancelled: boolean;
}

export interface ResourceSnapshot {
  name: string;
  capacity: number;
  inUse: number;
  queueLength: number;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface QueueEntry<TEventMap extends Record<string, unknown>, TStore> {
  readonly id: string;
  readonly requestedAt: number;
  readonly priority: number;
  readonly insertionOrder: number;
  readonly handle: RequestHandle;
  readonly callback: (ctx: SimContext<TEventMap, TStore>) => void;
}

// ---------------------------------------------------------------------------
// Resource class
// ---------------------------------------------------------------------------

/**
 * A shared resource with limited capacity implementing the seize/delay/release
 * pattern from queueing theory.
 *
 * When all slots are occupied, requests are queued in priority order (FIFO
 * within the same priority) and granted automatically when a slot is released.
 *
 * @example
 * ```ts
 * const servers = new Resource('servers', { capacity: 2 });
 *
 * sim.on('job:arrive', (event, ctx) => {
 *   servers.request(ctx, (ctx) => {
 *     // slot acquired — schedule work
 *     ctx.schedule('job:done', ctx.clock + serviceTime, { jobId });
 *   });
 * });
 *
 * sim.on('job:done', (_event, ctx) => {
 *   servers.release(ctx);
 * });
 * ```
 */
export class Resource<
  TEventMap extends Record<string, unknown> = Record<string, unknown>,
  TStore = Record<string, unknown>,
> {
  readonly name: string;
  readonly capacity: number;

  private readonly _statsPrefix: string;
  private _inUse = 0;
  private _requestCounter = 0;
  private readonly _queue: QueueEntry<TEventMap, TStore>[] = [];

  constructor(name: string, options: ResourceOptions = {}) {
    const capacity = options.capacity ?? 1;
    if (capacity <= 0) {
      throw new SimulationError(`Resource '${name}': capacity must be >= 1, got ${capacity}`);
    }
    this.name = name;
    this.capacity = capacity;
    this._statsPrefix = options.statsPrefix ?? name;
  }

  // ---------------------------------------------------------------------------
  // Accessors
  // ---------------------------------------------------------------------------

  /** Number of currently occupied slots (0 … capacity) */
  get inUse(): number {
    return this._inUse;
  }

  /** Number of requests waiting in the queue */
  get queueLength(): number {
    return this._queue.length;
  }

  /** True when at least one slot is free */
  get isAvailable(): boolean {
    return this._inUse < this.capacity;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Request a slot on this resource.
   *
   * - If a slot is free: the callback is invoked immediately (same sim-time).
   * - If all slots are busy: the request is queued and the callback fires
   *   when another holder calls release().
   *
   * The caller is responsible for calling resource.release(ctx) after use
   * (typically inside a downstream event handler scheduled from the callback).
   *
   * @returns A handle that can be passed to cancel() to withdraw a pending request.
   */
  request(
    ctx: SimContext<TEventMap, TStore>,
    cb: (ctx: SimContext<TEventMap, TStore>) => void,
    opts: RequestOptions = {},
  ): RequestHandle {
    const id = `${this.name}_req_${++this._requestCounter}`;
    const handle: RequestHandle = { id, cancelled: false };
    const prefix = this._statsPrefix;

    ctx.stats.increment(`resource.${prefix}.requests`);

    if (this._inUse < this.capacity) {
      // Slot available — grant immediately
      this._inUse++;
      ctx.stats.record(`resource.${prefix}.waitTime`, 0);
      ctx.stats.increment(`resource.${prefix}.grants`);
      ctx.stats.record(`resource.${prefix}.utilization`, this._inUse / this.capacity);
      cb(ctx);
    } else {
      // All slots busy — enqueue
      const entry: QueueEntry<TEventMap, TStore> = {
        id,
        requestedAt: ctx.clock,
        priority: opts.priority ?? 0,
        insertionOrder: this._requestCounter,
        handle,
        callback: cb,
      };
      this._insertSorted(entry);
      ctx.stats.record(`resource.${prefix}.queueLength`, this._queue.length);
    }

    return handle;
  }

  /**
   * Release one slot back to the resource.
   *
   * Immediately grants the next pending request in the queue (if any).
   *
   * @throws SimulationError if called when no slot is currently held.
   */
  release(ctx: SimContext<TEventMap, TStore>): void {
    if (this._inUse === 0) {
      throw new SimulationError(
        `Resource '${this.name}': release() called but no slot is currently held`,
      );
    }

    this._inUse--;
    const prefix = this._statsPrefix;
    ctx.stats.record(`resource.${prefix}.utilization`, this._inUse / this.capacity);

    // Drain next queued request (iterative to skip cancelled entries)
    while (this._queue.length > 0) {
      const entry = this._queue.shift()!;

      if (entry.handle.cancelled) continue;

      this._inUse++;
      const waitTime = ctx.clock - entry.requestedAt;
      ctx.stats.record(`resource.${prefix}.waitTime`, waitTime);
      ctx.stats.increment(`resource.${prefix}.grants`);
      ctx.stats.record(`resource.${prefix}.queueLength`, this._queue.length);
      ctx.stats.record(`resource.${prefix}.utilization`, this._inUse / this.capacity);
      entry.callback(ctx);
      break;
    }
  }

  /**
   * Cancel a pending (not yet granted) request.
   *
   * If the request was already granted or not found, returns false (no-op).
   * Returns true if the request was successfully removed from the queue.
   */
  cancel(handle: RequestHandle): boolean {
    handle.cancelled = true;
    const idx = this._queue.findIndex((e) => e.handle === handle);
    if (idx === -1) return false;
    this._queue.splice(idx, 1);
    return true;
  }

  /**
   * Return a plain snapshot of the resource's current state.
   */
  snapshot(): ResourceSnapshot {
    return {
      name: this.name,
      capacity: this.capacity,
      inUse: this._inUse,
      queueLength: this._queue.length,
    };
  }

  /**
   * Reset internal state. Call after engine.reset() before re-running.
   */
  reset(): void {
    this._inUse = 0;
    this._queue.length = 0;
    this._requestCounter = 0;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Insert entry maintaining sort order: (priority ASC, insertionOrder ASC) */
  private _insertSorted(entry: QueueEntry<TEventMap, TStore>): void {
    let i = this._queue.length;
    while (
      i > 0 &&
      (this._queue[i - 1].priority > entry.priority ||
        (this._queue[i - 1].priority === entry.priority &&
          this._queue[i - 1].insertionOrder > entry.insertionOrder))
    ) {
      i--;
    }
    this._queue.splice(i, 0, entry);
  }
}
