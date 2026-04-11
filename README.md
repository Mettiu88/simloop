# Simloop

[![npm version](https://img.shields.io/npm/v/simloop)](https://www.npmjs.com/package/simloop)
[![license](https://img.shields.io/npm/l/simloop)](./LICENSE)
[![build](https://img.shields.io/github/actions/workflow/status/Mettiu88/simloop/ci.yml?branch=master)](https://github.com/Mettiu88/simloop/actions)
[![npm bundle size](https://img.shields.io/bundlephobia/minzip/simloop)](https://bundlephobia.com/package/simloop)
[![types](https://img.shields.io/npm/types/simloop)](https://www.npmjs.com/package/simloop)

A general-purpose discrete event simulation (DES) framework for Node.js, written in TypeScript.

Simloop provides a minimal, type-safe API for building simulations of real-world systems. You define events, entities, and handlers — the framework runs the event loop.

## Features

- **Type-safe** — generic `TEventMap` gives full autocomplete and type checking on event scheduling and handling
- **Simple API** — define handlers with `sim.on()`, schedule events with `ctx.schedule()`
- **Deterministic** — seeded PRNG ensures reproducible results
- **Built-in primitives** — Resource (seize/delay/release) and Queue (FIFO/priority, bounded capacity, overflow policies) with auto-collected stats
- **11 probability distributions** — uniform, gaussian, exponential, poisson, bernoulli, zipf, triangular, weibull, lognormal, erlang, geometric
- **Simulation control** — lifecycle management, custom stop conditions (`stopWhen`), warm-up period with automatic stats reset
- **Observability** — built-in statistics (mean, variance, min, max, count) and pluggable logging
- **Zero dependencies, dual format** — no runtime deps, ESM and CJS

## Documentation

For the full API reference, guides, and examples visit the documentation site:

**[simloop.vercel.app](https://simloop.vercel.app/)**

## License

MIT
