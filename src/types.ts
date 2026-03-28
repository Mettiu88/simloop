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

/** Simulation context passed to event handlers */
export interface SimContext<TEventMap extends Record<string, unknown>> {
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
}

/** Event handler function signature */
export type EventHandler<
  TEventMap extends Record<string, unknown>,
  TType extends keyof TEventMap & string,
> = (event: SimEvent<TType, TEventMap[TType]>, ctx: SimContext<TEventMap>) => void;

/** Simulation lifecycle status */
export type SimulationStatus = 'idle' | 'running' | 'paused' | 'stopped' | 'finished';

/** Result termination reason */
export type SimulationEndStatus = 'finished' | 'stopped' | 'maxTimeReached' | 'maxEventsReached';

/** Result returned after a simulation run */
export interface SimulationResult {
  readonly totalEventsProcessed: number;
  readonly totalEventsCancelled: number;
  readonly finalClock: number;
  readonly wallClockMs: number;
  readonly stats: Record<string, StatsSummary>;
  readonly status: SimulationEndStatus;
}

/** Engine configuration options */
export interface SimulationEngineOptions {
  seed?: number;
  maxTime?: number;
  maxEvents?: number;
  logLevel?: LogLevel;
  logger?: SimLogger;
  name?: string;
  realTimeDelay?: number;
}
