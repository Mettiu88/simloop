# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

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
