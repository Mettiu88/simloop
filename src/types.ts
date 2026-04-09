/** Simulation event with generic type tag and payload */
export interface SimEvent<TType extends string = string, TPayload = unknown> {
  readonly id: string;
  readonly time: number;
  readonly type: TType;
  readonly payload: TPayload;
  readonly createdAt: number;
  cancelled: boolean;
}

/** Simulation entity with generic state */
export interface SimEntity<TState = unknown> {
  readonly id: string;
  state: TState;
}

/** Log severity levels */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

/** Pluggable logger interface */
export interface SimLogger {
  log(level: LogLevel, clock: number, message: string, data?: unknown): void;
}

/** Summary statistics for a named metric */
export interface StatsSummary {
  count: number;
  sum: number;
  min: number;
  max: number;
  mean: number;
  variance: number;
}

/** Statistics collector interface */
export interface StatsCollector {
  record(name: string, value: number): void;
  increment(name: string, by?: number): void;
  get(name: string): StatsSummary;
  getAll(): Record<string, StatsSummary>;
  reset(): void;
}

/** Distribution helper with pre-bound RNG. Each method returns a sampler () => number. */
export interface DistributionHelper {
  uniform(a: number, b: number): () => number;
  gaussian(mean?: number, stddev?: number): () => number;
  exponential(rate: number): () => number;
  poisson(lambda: number): () => number;
  bernoulli(p: number): () => number;
  zipf(n: number, s: number): () => number;
  triangular(min: number, mode: number, max: number): () => number;
  weibull(scale: number, shape: number): () => number;
  lognormal(mu?: number, sigma?: number): () => number;
  erlang(k: number, rate: number): () => number;
  geometric(p: number): () => number;
}

/** Simulation context passed to event handlers */
export interface SimContext<TEventMap extends Record<string, unknown>, TStore = Record<string, unknown>> {
  readonly clock: number;

  schedule<K extends keyof TEventMap & string>(
    type: K,
    time: number,
    payload: TEventMap[K],
  ): SimEvent<K, TEventMap[K]>;

  cancelEvent(event: SimEvent): void;

  getEntity<T>(id: string): SimEntity<T> | undefined;
  addEntity<T>(entity: SimEntity<T>): void;
  removeEntity(id: string): void;
  getAllEntities(): ReadonlyArray<SimEntity>;

  stats: StatsCollector;
  log(level: LogLevel, message: string, data?: unknown): void;
  random(): number;
  dist: DistributionHelper;

  /** Whether the warm-up period has completed (always true if no warmUpTime is set) */
  readonly warmUpCompleted: boolean;

  store: TStore;
}

/** Event handler function signature */
export type EventHandler<
  TEventMap extends Record<string, unknown>,
  TType extends keyof TEventMap & string,
  TStore = Record<string, unknown>,
> = (event: SimEvent<TType, TEventMap[TType]>, ctx: SimContext<TEventMap, TStore>) => void;

/** Simulation lifecycle status */
export type SimulationStatus = 'idle' | 'running' | 'paused' | 'stopped' | 'finished';

/** Result termination reason */
export type SimulationEndStatus = 'finished' | 'stopped' | 'maxTimeReached' | 'maxEventsReached' | 'stopConditionMet';

/** Result returned after a simulation run */
export interface SimulationResult<TStore = Record<string, unknown>> {
  readonly totalEventsProcessed: number;
  readonly totalEventsCancelled: number;
  readonly finalClock: number;
  readonly wallClockMs: number;
  readonly stats: Record<string, StatsSummary>;
  readonly status: SimulationEndStatus;
  readonly store: TStore;
}

/** Engine configuration options */
export interface SimulationEngineOptions<
  TEventMap extends Record<string, unknown> = Record<string, unknown>,
  TStore = Record<string, unknown>,
> {
  seed?: number;
  maxTime?: number;
  maxEvents?: number;
  logLevel?: LogLevel;
  logger?: SimLogger;
  name?: string;
  realTimeDelay?: number;

  /** Warm-up time: stats are automatically reset when the clock crosses this threshold.
   *  Useful for discarding transient initial bias and collecting steady-state statistics.
   *  Default: undefined (no warm-up). */
  warmUpTime?: number;

  /** Custom stop condition evaluated after each event. When it returns `true` the
   *  simulation ends with status `'stopConditionMet'`.
   *  Useful for optimisation, steady-state detection, and Monte Carlo convergence.
   *  Default: undefined (no custom stop condition). */
  stopWhen?: (ctx: SimContext<TEventMap, TStore>) => boolean;

  store?: TStore;
}
