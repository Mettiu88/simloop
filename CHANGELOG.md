# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.2.0] - 2026-03-31

### Added

- `triangular(rng, min, mode, max)` — triangular distribution; three-point estimate for when only min/mode/max are known (PERT, expert estimates)
- `weibull(rng, scale, shape)` — Weibull distribution; reliability and failure analysis (shape < 1: early failures, shape = 1: exponential, shape > 1: wear-out)
- `lognormal(rng, mu?, sigma?)` — lognormal distribution; right-skewed service times, repair durations, response times
- `erlang(rng, k, rate)` — Erlang distribution; sum of k exponentials, models k-stage sequential processes; k=1 is equivalent to exponential
- `geometric(rng, p)` — geometric distribution; number of trials until first success, minimum value is 1

## [0.1.4] - 2026-03-31

### Added

- `Resource` — seize/delay/release primitive for capacity-constrained shared resources (M/M/c queueing pattern)
  - `request(ctx, cb, opts?)` — acquires a slot; callback fires immediately if free, queued otherwise
  - `release(ctx)` — frees a slot and automatically grants the next queued request
  - `cancel(handle)` — withdraws a pending request from the queue
  - `snapshot()` — returns a plain state object (`name`, `capacity`, `inUse`, `queueLength`)
  - `reset()` — clears internal state for re-run after `engine.reset()`
  - Priority queuing via `RequestOptions.priority` (lower = higher precedence, FIFO within same priority)
  - Auto-collected statistics: `resource.{name}.waitTime`, `queueLength`, `utilization`, `requests`, `grants`
- `ResourceOptions`, `RequestOptions`, `RequestHandle`, `ResourceSnapshot` — exported types
- `docs/resource-spec.md` — full API specification with queueing theory background, usage examples, and edge case documentation
- `coffee-shop` example rewritten using `Resource` (345 → ~200 lines)

### Changed

- `docs/functional-requirements.md` renamed to `docs/simloop-general-specs.md`

## [0.1.3] - 2026-03-29

### Added

- `ctx.store` — global typed store (`TStore`) accessible in all handlers and hooks; persisted in `SimulationResult` and deep-cloned on `reset()`
- `store` option in `SimulationEngineOptions` to set the initial store value
- `store-counter` example demonstrating `ctx.store` usage

## [0.1.1] - 2026-03-28

### Added

- Probability distributions module: `uniform`, `gaussian`, `exponential`, `poisson`, `bernoulli`, `zipf`
- All distributions are composable factories: `(rng: () => number, ...params) => () => number`
- CI workflow via GitHub Actions
- `network-packets` example demonstrating all six distributions in a realistic router simulation

### Fixed

- Repository URL format in `package.json`

## [0.1.0] - 2026-03-28

### Added

- `SimulationEngine` — core discrete event simulation engine with full lifecycle management (idle, running, paused, stopped, finished)
- `SimEvent` — generic typed events with timestamps, payloads, and cancellation support
- `SimEntity` — minimal entity interface with generic state
- `SimContext` — context object for event handlers with scheduling, entity management, stats, logging, and seeded PRNG
- `PriorityQueue` — binary min-heap with FIFO tiebreaker for deterministic event ordering
- `SeededRandom` — Mulberry32 pseudo-random number generator for reproducible simulations
- `DefaultStatsCollector` — online statistics with Welford's algorithm (count, sum, min, max, mean, variance)
- `ConsoleLogger` — pluggable logger with simulation time prefix
- Lifecycle hooks: `beforeEach`, `afterEach`, `onEnd`
- Sync (`run()`) and async (`runAsync()`) execution modes
- Full TypeScript type safety via `TEventMap` generics
- ESM and CJS dual module output
- Coffee shop example simulation
