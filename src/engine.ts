import type {
  EventHandler,
  LogLevel,
  SimContext,
  SimEntity,
  SimEvent,
  SimulationEngineOptions,
  SimulationResult,
  SimulationStatus,
  StatsCollector,
} from './types.js';
import { PriorityQueue } from './priority-queue.js';
import { SeededRandom } from './prng.js';
import { DefaultStatsCollector } from './stats.js';
import { ConsoleLogger } from './logger.js';

/** Error thrown for invalid simulation operations */
export class SimulationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SimulationError';
  }
}

type HookFn<TEventMap extends Record<string, unknown>> = (
  event: SimEvent,
  ctx: SimContext<TEventMap>,
) => void;

type EndHookFn<TEventMap extends Record<string, unknown>> = (
  ctx: SimContext<TEventMap>,
) => void;

/**
 * Discrete event simulation engine.
 *
 * Generic parameter `TEventMap` maps event type strings to their payload types,
 * providing full type safety for event scheduling and handling.
 */
export class SimulationEngine<TEventMap extends Record<string, unknown>> {
  private _clock = 0;
  private _status: SimulationStatus = 'idle';
  private _eventsProcessed = 0;
  private _eventsCancelled = 0;

  private readonly queue = new PriorityQueue();
  private readonly entities = new Map<string, SimEntity>();
  private readonly handlers = new Map<string, EventHandler<TEventMap, string>>();
  private readonly beforeEachHooks: HookFn<TEventMap>[] = [];
  private readonly afterEachHooks: HookFn<TEventMap>[] = [];
  private readonly onEndHooks: EndHookFn<TEventMap>[] = [];

  private readonly rng: SeededRandom;
  private readonly _stats: DefaultStatsCollector;
  private readonly logger: ConsoleLogger;

  private readonly seed: number;
  private readonly maxTime: number;
  private readonly maxEvents: number;
  private readonly realTimeDelay: number;

  private eventIdCounter = 0;
  private context!: SimContext<TEventMap>;

  constructor(private readonly options: SimulationEngineOptions = {}) {
    this.seed = options.seed ?? Date.now();
    this.maxTime = options.maxTime ?? Infinity;
    this.maxEvents = options.maxEvents ?? Infinity;
    this.realTimeDelay = options.realTimeDelay ?? 0;

    this.rng = new SeededRandom(this.seed);
    this._stats = new DefaultStatsCollector();
    this.logger = new ConsoleLogger(
      options.name ?? 'Simulation',
      options.logLevel ?? 'info',
    );

    this.buildContext();
  }

  // --- Public read-only state ---

  get clock(): number {
    return this._clock;
  }

  get status(): SimulationStatus {
    return this._status;
  }

  get eventsProcessed(): number {
    return this._eventsProcessed;
  }

  get eventsQueued(): number {
    return this.queue.size;
  }

  // --- Handler registration ---

  on<K extends keyof TEventMap & string>(
    type: K,
    handler: EventHandler<TEventMap, K>,
  ): this {
    this.handlers.set(type, handler as EventHandler<TEventMap, string>);
    return this;
  }

  // --- Lifecycle hooks ---

  beforeEach(hook: HookFn<TEventMap>): this {
    this.beforeEachHooks.push(hook);
    return this;
  }

  afterEach(hook: HookFn<TEventMap>): this {
    this.afterEachHooks.push(hook);
    return this;
  }

  onEnd(hook: EndHookFn<TEventMap>): this {
    this.onEndHooks.push(hook);
    return this;
  }

  // --- Lifecycle ---

  init(setup: (ctx: SimContext<TEventMap>) => void): this {
    if (this._status !== 'idle') {
      throw new SimulationError(`Cannot init in '${this._status}' state. Call reset() first.`);
    }
    this.logInternal('debug', 'Initializing simulation');
    setup(this.context);
    return this;
  }

  run(): SimulationResult {
    this.assertCanRun();
    this._status = 'running';
    this.logInternal('info', 'Simulation started');

    const wallStart = performance.now();

    this.executeLoop();

    const wallClockMs = performance.now() - wallStart;
    return this.buildResult(wallClockMs);
  }

  async runAsync(): Promise<SimulationResult> {
    this.assertCanRun();
    this._status = 'running';
    this.logInternal('info', 'Simulation started (async)');

    const wallStart = performance.now();

    await this.executeLoopAsync();

    const wallClockMs = performance.now() - wallStart;
    return this.buildResult(wallClockMs);
  }

  pause(): void {
    if (this._status !== 'running') {
      throw new SimulationError(`Cannot pause in '${this._status}' state.`);
    }
    this._status = 'paused';
    this.logInternal('info', 'Simulation paused');
  }

  resume(): void {
    if (this._status !== 'paused') {
      throw new SimulationError(`Cannot resume in '${this._status}' state.`);
    }
    this._status = 'running';
    this.logInternal('info', 'Simulation resumed');
  }

  stop(): void {
    if (this._status !== 'running' && this._status !== 'paused') {
      throw new SimulationError(`Cannot stop in '${this._status}' state.`);
    }
    this._status = 'stopped';
    this.logInternal('info', 'Simulation stopped');
  }

  reset(): void {
    if (this._status !== 'stopped' && this._status !== 'finished') {
      throw new SimulationError(`Cannot reset in '${this._status}' state.`);
    }
    this._clock = 0;
    this._eventsProcessed = 0;
    this._eventsCancelled = 0;
    this.eventIdCounter = 0;
    this.queue.clear();
    this.entities.clear();
    this._stats.reset();
    this.rng.reset(this.seed);
    this._status = 'idle';
    this.buildContext();
    this.logInternal('debug', 'Simulation reset');
  }

  // --- Internal: main loop ---

  private executeLoop(): void {
    while (this.shouldContinue()) {
      const event = this.queue.dequeue();
      if (!event) break;

      if (event.cancelled) {
        this._eventsCancelled++;
        continue;
      }

      this._clock = event.time;
      this.buildContext(); // refresh context with new clock

      for (const hook of this.beforeEachHooks) {
        hook(event, this.context);
      }

      const handler = this.handlers.get(event.type);
      if (handler) {
        handler(event as SimEvent<string, TEventMap[string]>, this.context);
      } else {
        this.logInternal('warn', `No handler for event type '${event.type}'`);
      }

      for (const hook of this.afterEachHooks) {
        hook(event, this.context);
      }

      this._eventsProcessed++;
    }

    this.finalize();
  }

  private async executeLoopAsync(): Promise<void> {
    let batchCount = 0;
    const YIELD_INTERVAL = 1000; // yield to Node.js event loop every N events

    while (this.shouldContinue()) {
      const event = this.queue.dequeue();
      if (!event) break;

      if (event.cancelled) {
        this._eventsCancelled++;
        continue;
      }

      this._clock = event.time;
      this.buildContext();

      for (const hook of this.beforeEachHooks) {
        hook(event, this.context);
      }

      const handler = this.handlers.get(event.type);
      if (handler) {
        handler(event as SimEvent<string, TEventMap[string]>, this.context);
      } else {
        this.logInternal('warn', `No handler for event type '${event.type}'`);
      }

      for (const hook of this.afterEachHooks) {
        hook(event, this.context);
      }

      this._eventsProcessed++;
      batchCount++;

      // Yield to the Node.js event loop periodically
      if (this.realTimeDelay > 0) {
        await this.delay(this.realTimeDelay);
        batchCount = 0;
      } else if (batchCount >= YIELD_INTERVAL) {
        await this.delay(0);
        batchCount = 0;
      }
    }

    this.finalize();
  }

  private shouldContinue(): boolean {
    if (this._status !== 'running') return false;
    if (this.queue.isEmpty) return false;
    if (this._eventsProcessed >= this.maxEvents) return false;

    const next = this.queue.peek();
    if (next && next.time > this.maxTime) return false;

    return true;
  }

  private finalize(): void {
    if (this._status === 'stopped') return; // already set by stop()

    if (this._eventsProcessed >= this.maxEvents) {
      this._status = 'finished';
    } else if (!this.queue.isEmpty && this.queue.peek()!.time > this.maxTime) {
      this._status = 'finished';
    } else {
      this._status = 'finished';
    }

    for (const hook of this.onEndHooks) {
      hook(this.context);
    }

    this.logInternal('info', `Simulation finished. Events processed: ${this._eventsProcessed}`);
  }

  private buildResult(wallClockMs: number): SimulationResult {
    let endStatus: SimulationResult['status'];

    if (this._status === 'stopped') {
      endStatus = 'stopped';
    } else if (this._eventsProcessed >= this.maxEvents) {
      endStatus = 'maxEventsReached';
    } else if (this._clock >= this.maxTime) {
      endStatus = 'maxTimeReached';
    } else {
      endStatus = 'finished';
    }

    return {
      totalEventsProcessed: this._eventsProcessed,
      totalEventsCancelled: this._eventsCancelled,
      finalClock: this._clock,
      wallClockMs,
      stats: this._stats.getAll(),
      status: endStatus,
    };
  }

  // --- Internal: context ---

  private buildContext(): void {
    const engine = this;

    this.context = {
      get clock() {
        return engine._clock;
      },

      schedule<K extends keyof TEventMap & string>(
        type: K,
        time: number,
        payload: TEventMap[K],
      ): SimEvent<K, TEventMap[K]> {
        if (time < engine._clock) {
          throw new SimulationError(
            `Cannot schedule event '${type}' at time ${time}: current clock is ${engine._clock}`,
          );
        }

        const event: SimEvent<K, TEventMap[K]> = {
          id: `evt_${engine.eventIdCounter++}`,
          time,
          type,
          payload,
          createdAt: engine._clock,
          cancelled: false,
        };

        engine.queue.enqueue(event as SimEvent);
        return event;
      },

      cancelEvent(event: SimEvent): void {
        event.cancelled = true;
      },

      getEntity<T>(id: string): SimEntity<T> | undefined {
        return engine.entities.get(id) as SimEntity<T> | undefined;
      },

      addEntity<T>(entity: SimEntity<T>): void {
        engine.entities.set(entity.id, entity as SimEntity);
      },

      removeEntity(id: string): void {
        engine.entities.delete(id);
      },

      getAllEntities(): ReadonlyArray<SimEntity> {
        return Array.from(engine.entities.values());
      },

      stats: engine._stats,

      log(level: LogLevel, message: string, data?: unknown): void {
        const loggerImpl = engine.options.logger ?? engine.logger;
        loggerImpl.log(level, engine._clock, message, data);
      },

      random(): number {
        return engine.rng.next();
      },
    };
  }

  // --- Internal: helpers ---

  private assertCanRun(): void {
    if (this._status !== 'idle' && this._status !== 'paused') {
      throw new SimulationError(
        `Cannot run in '${this._status}' state. ${
          this._status === 'stopped' || this._status === 'finished'
            ? 'Call reset() first.'
            : ''
        }`,
      );
    }
  }

  private logInternal(level: LogLevel, message: string): void {
    const loggerImpl = this.options.logger ?? this.logger;
    loggerImpl.log(level, this._clock, message);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
