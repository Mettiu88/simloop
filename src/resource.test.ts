import { describe, it, expect } from 'vitest';
import { SimulationEngine, SimulationError } from './engine.js';
import { Resource } from './resource.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

type TestEvents = {
  start: Record<string, never>;
  done: Record<string, never>;
};

function makeEngine(seed = 1) {
  return new SimulationEngine<TestEvents>({ seed });
}

// ---------------------------------------------------------------------------
// Immediate grant (slot available)
// ---------------------------------------------------------------------------

describe('Resource — immediate grant', () => {
  it('invokes callback at same sim-time when slot is free', () => {
    const sim = makeEngine();
    const resource = new Resource<TestEvents>('server');
    const grantedAt: number[] = [];

    sim.on('start', (_e, ctx) => {
      resource.request(ctx, (ctx) => {
        grantedAt.push(ctx.clock);
        resource.release(ctx);
      });
    });

    sim.init((ctx) => ctx.schedule('start', 5, {}));
    sim.run();

    expect(grantedAt).toEqual([5]);
  });

  it('increments inUse on request and decrements on release', () => {
    const sim = makeEngine();
    const resource = new Resource<TestEvents>('server');
    const snapshots: number[] = [];

    sim.on('start', (_e, ctx) => {
      resource.request(ctx, (ctx) => {
        snapshots.push(resource.inUse); // should be 1
        resource.release(ctx);
        snapshots.push(resource.inUse); // should be 0
      });
    });

    sim.init((ctx) => ctx.schedule('start', 1, {}));
    sim.run();

    expect(snapshots).toEqual([1, 0]);
  });

  it('allows up to capacity simultaneous acquisitions without queuing', () => {
    const sim = makeEngine();
    const resource = new Resource<TestEvents>('servers', { capacity: 3 });
    let peakInUse = 0;

    sim.on('start', (_e, ctx) => {
      resource.request(ctx, () => { peakInUse = Math.max(peakInUse, resource.inUse); });
      resource.request(ctx, () => { peakInUse = Math.max(peakInUse, resource.inUse); });
      resource.request(ctx, () => { peakInUse = Math.max(peakInUse, resource.inUse); });
      // all 3 should be granted immediately — queue stays empty
      expect(resource.queueLength).toBe(0);
    });

    sim.init((ctx) => ctx.schedule('start', 1, {}));
    sim.run();

    expect(peakInUse).toBe(3);
  });

  it('records waitTime = 0 for immediate grants', () => {
    const sim = makeEngine();
    const resource = new Resource<TestEvents>('server');

    sim.on('start', (_e, ctx) => {
      resource.request(ctx, (ctx) => { resource.release(ctx); });
    });

    sim.init((ctx) => ctx.schedule('start', 1, {}));
    const result = sim.run();

    expect(result.stats['resource.server.waitTime'].min).toBe(0);
    expect(result.stats['resource.server.waitTime'].mean).toBe(0);
  });

  it('isAvailable is false once capacity is reached', () => {
    const sim = makeEngine();
    const resource = new Resource<TestEvents>('server', { capacity: 1 });
    const availability: boolean[] = [];

    sim.on('start', (_e, ctx) => {
      availability.push(resource.isAvailable); // true before
      resource.request(ctx, () => {
        availability.push(resource.isAvailable); // false after grant
      });
    });

    sim.init((ctx) => ctx.schedule('start', 1, {}));
    sim.run();

    expect(availability).toEqual([true, false]);
  });
});

// ---------------------------------------------------------------------------
// Queueing (capacity exhausted)
// ---------------------------------------------------------------------------

describe('Resource — queueing', () => {
  it('enqueues request when all slots are busy', () => {
    const sim = makeEngine();
    const resource = new Resource<TestEvents>('server', { capacity: 1 });
    let queueLengthAfterSecond = -1;

    sim.on('start', (_e, ctx) => {
      resource.request(ctx, () => { /* holds slot */ });
      resource.request(ctx, () => { /* queued */ });
      queueLengthAfterSecond = resource.queueLength;
    });

    sim.init((ctx) => ctx.schedule('start', 1, {}));
    sim.run();

    expect(queueLengthAfterSecond).toBe(1);
  });

  it('grants queued request when release() is called', () => {
    const sim = makeEngine();
    const resource = new Resource<TestEvents>('server', { capacity: 1 });
    const grantOrder: string[] = [];

    sim.on('start', (_e, ctx) => {
      resource.request(ctx, (ctx) => {
        grantOrder.push('first');
        // schedule release at t=10
        ctx.schedule('done', 10, {});
      });
      resource.request(ctx, (ctx) => {
        grantOrder.push('second');
        resource.release(ctx);
      });
    });

    sim.on('done', (_e, ctx) => {
      resource.release(ctx); // triggers second grant
    });

    sim.init((ctx) => ctx.schedule('start', 1, {}));
    sim.run();

    expect(grantOrder).toEqual(['first', 'second']);
  });

  it('records positive waitTime for queued requests', () => {
    const sim = makeEngine();
    const resource = new Resource<TestEvents>('server', { capacity: 1 });

    sim.on('start', (_e, ctx) => {
      resource.request(ctx, (ctx) => {
        ctx.schedule('done', ctx.clock + 5, {}); // holds for 5 time units
      });
      resource.request(ctx, (ctx) => {
        resource.release(ctx);
      });
    });

    sim.on('done', (_e, ctx) => {
      resource.release(ctx);
    });

    sim.init((ctx) => ctx.schedule('start', 0, {}));
    const result = sim.run();

    // second request waited 5 time units
    expect(result.stats['resource.server.waitTime'].max).toBe(5);
    expect(result.stats['resource.server.waitTime'].mean).toBeGreaterThan(0);
  });

  it('drains multiple queued requests in FIFO order when capacity > 1', () => {
    const sim = makeEngine();
    const resource = new Resource<TestEvents>('server', { capacity: 1 });
    const order: number[] = [];

    sim.on('start', (_e, ctx) => {
      // fill the slot
      resource.request(ctx, (ctx) => { ctx.schedule('done', ctx.clock + 10, {}); });
      // queue 3 more
      resource.request(ctx, () => { order.push(1); resource.release(ctx); });
      resource.request(ctx, () => { order.push(2); resource.release(ctx); });
      resource.request(ctx, () => { order.push(3); resource.release(ctx); });
    });

    sim.on('done', (_e, ctx) => { resource.release(ctx); });

    sim.init((ctx) => ctx.schedule('start', 0, {}));
    sim.run();

    expect(order).toEqual([1, 2, 3]);
  });
});

// ---------------------------------------------------------------------------
// Priority
// ---------------------------------------------------------------------------

describe('Resource — priority', () => {
  it('serves lower priority number first', () => {
    const sim = makeEngine();
    const resource = new Resource<TestEvents>('server', { capacity: 1 });
    const order: string[] = [];

    sim.on('start', (_e, ctx) => {
      resource.request(ctx, (ctx) => { ctx.schedule('done', ctx.clock + 10, {}); });
      resource.request(ctx, () => { order.push('low'); resource.release(ctx); }, { priority: 10 });
      resource.request(ctx, () => { order.push('high'); resource.release(ctx); }, { priority: 1 });
      resource.request(ctx, () => { order.push('medium'); resource.release(ctx); }, { priority: 5 });
    });

    sim.on('done', (_e, ctx) => { resource.release(ctx); });

    sim.init((ctx) => ctx.schedule('start', 0, {}));
    sim.run();

    expect(order).toEqual(['high', 'medium', 'low']);
  });

  it('uses FIFO tie-breaking within same priority', () => {
    const sim = makeEngine();
    const resource = new Resource<TestEvents>('server', { capacity: 1 });
    const order: string[] = [];

    sim.on('start', (_e, ctx) => {
      resource.request(ctx, (ctx) => { ctx.schedule('done', ctx.clock + 10, {}); });
      resource.request(ctx, () => { order.push('A'); resource.release(ctx); }, { priority: 0 });
      resource.request(ctx, () => { order.push('B'); resource.release(ctx); }, { priority: 0 });
      resource.request(ctx, () => { order.push('C'); resource.release(ctx); }, { priority: 0 });
    });

    sim.on('done', (_e, ctx) => { resource.release(ctx); });

    sim.init((ctx) => ctx.schedule('start', 0, {}));
    sim.run();

    expect(order).toEqual(['A', 'B', 'C']);
  });
});

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------

describe('Resource — cancellation', () => {
  it('cancel() returns false for an already-granted request', () => {
    const sim = makeEngine();
    const resource = new Resource<TestEvents>('server');

    sim.on('start', (_e, ctx) => {
      const handle = resource.request(ctx, (ctx) => { resource.release(ctx); });
      // handle was granted immediately
      const result = resource.cancel(handle);
      expect(result).toBe(false);
    });

    sim.init((ctx) => ctx.schedule('start', 1, {}));
    sim.run();
  });

  it('cancel() removes request from queue and returns true', () => {
    const sim = makeEngine();
    const resource = new Resource<TestEvents>('server', { capacity: 1 });
    let cancelResult = false;

    sim.on('start', (_e, ctx) => {
      resource.request(ctx, () => { /* holds slot */ });
      const handle = resource.request(ctx, () => { /* queued */ });
      cancelResult = resource.cancel(handle);
      expect(resource.queueLength).toBe(0);
    });

    sim.init((ctx) => ctx.schedule('start', 1, {}));
    sim.run();

    expect(cancelResult).toBe(true);
  });

  it('cancelled request is skipped; next in queue is served', () => {
    const sim = makeEngine();
    const resource = new Resource<TestEvents>('server', { capacity: 1 });
    const order: string[] = [];

    sim.on('start', (_e, ctx) => {
      resource.request(ctx, (ctx) => { ctx.schedule('done', ctx.clock + 5, {}); });
      const handleA = resource.request(ctx, () => { order.push('A'); resource.release(ctx); });
      resource.request(ctx, () => { order.push('B'); resource.release(ctx); });
      resource.cancel(handleA);
    });

    sim.on('done', (_e, ctx) => { resource.release(ctx); });

    sim.init((ctx) => ctx.schedule('start', 0, {}));
    sim.run();

    expect(order).toEqual(['B']);
  });

  it('callback is never called after cancel()', () => {
    const sim = makeEngine();
    const resource = new Resource<TestEvents>('server', { capacity: 1 });
    let cbCalled = false;

    sim.on('start', (_e, ctx) => {
      resource.request(ctx, () => { /* holds forever */ });
      const handle = resource.request(ctx, () => { cbCalled = true; });
      resource.cancel(handle);
    });

    sim.init((ctx) => ctx.schedule('start', 1, {}));
    sim.run();

    expect(cbCalled).toBe(false);
  });

  it('handle.cancelled is true after cancel()', () => {
    const sim = makeEngine();
    const resource = new Resource<TestEvents>('server', { capacity: 1 });

    sim.on('start', (_e, ctx) => {
      resource.request(ctx, () => { /* holds */ });
      const handle = resource.request(ctx, () => {});
      expect(handle.cancelled).toBe(false);
      resource.cancel(handle);
      expect(handle.cancelled).toBe(true);
    });

    sim.init((ctx) => ctx.schedule('start', 1, {}));
    sim.run();
  });
});

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

describe('Resource — statistics', () => {
  it('requests.count equals total request() calls', () => {
    const sim = makeEngine();
    const resource = new Resource<TestEvents>('srv', { capacity: 3 });

    sim.on('start', (_e, ctx) => {
      resource.request(ctx, (ctx) => { resource.release(ctx); });
      resource.request(ctx, (ctx) => { resource.release(ctx); });
      resource.request(ctx, (ctx) => { resource.release(ctx); });
    });

    sim.init((ctx) => ctx.schedule('start', 1, {}));
    const result = sim.run();

    expect(result.stats['resource.srv.requests'].count).toBe(3);
  });

  it('grants.count equals successful acquisitions', () => {
    const sim = makeEngine();
    const resource = new Resource<TestEvents>('srv', { capacity: 1 });

    sim.on('start', (_e, ctx) => {
      resource.request(ctx, (ctx) => { ctx.schedule('done', ctx.clock + 1, {}); });
      resource.request(ctx, (ctx) => { resource.release(ctx); });
    });

    sim.on('done', (_e, ctx) => { resource.release(ctx); });

    sim.init((ctx) => ctx.schedule('start', 0, {}));
    const result = sim.run();

    expect(result.stats['resource.srv.grants'].count).toBe(2);
  });

  it('waitTime.min = 0 when at least one immediate grant occurred', () => {
    const sim = makeEngine();
    const resource = new Resource<TestEvents>('srv', { capacity: 1 });

    sim.on('start', (_e, ctx) => {
      resource.request(ctx, (ctx) => { ctx.schedule('done', ctx.clock + 5, {}); });
      resource.request(ctx, (ctx) => { resource.release(ctx); }); // queued
    });

    sim.on('done', (_e, ctx) => { resource.release(ctx); });

    sim.init((ctx) => ctx.schedule('start', 0, {}));
    const result = sim.run();

    expect(result.stats['resource.srv.waitTime'].min).toBe(0);
    expect(result.stats['resource.srv.waitTime'].max).toBe(5);
  });

  it('queueLength.max equals peak queue depth observed', () => {
    const sim = makeEngine();
    const resource = new Resource<TestEvents>('srv', { capacity: 1 });

    sim.on('start', (_e, ctx) => {
      resource.request(ctx, () => { /* holds forever */ });
      resource.request(ctx, () => {});
      resource.request(ctx, () => {});
      resource.request(ctx, () => {});
    });

    sim.init((ctx) => ctx.schedule('start', 1, {}));
    const result = sim.run();

    expect(result.stats['resource.srv.queueLength'].max).toBe(3);
  });

  it('uses custom statsPrefix when provided', () => {
    const sim = makeEngine();
    const resource = new Resource<TestEvents>('internal-id', { statsPrefix: 'myPrefix' });

    sim.on('start', (_e, ctx) => {
      resource.request(ctx, (ctx) => { resource.release(ctx); });
    });

    sim.init((ctx) => ctx.schedule('start', 1, {}));
    const result = sim.run();

    expect(result.stats['resource.myPrefix.requests']).toBeDefined();
    expect(result.stats['resource.internal-id.requests']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Edge cases / error handling
// ---------------------------------------------------------------------------

describe('Resource — edge cases', () => {
  it('throws SimulationError on release() when inUse === 0', () => {
    const sim = makeEngine();
    const resource = new Resource<TestEvents>('server');

    sim.on('start', (_e, ctx) => {
      expect(() => resource.release(ctx)).toThrow(SimulationError);
    });

    sim.init((ctx) => ctx.schedule('start', 1, {}));
    sim.run();
  });

  it('throws SimulationError when capacity <= 0', () => {
    expect(() => new Resource('x', { capacity: 0 })).toThrow(SimulationError);
    expect(() => new Resource('x', { capacity: -1 })).toThrow(SimulationError);
  });

  it('snapshot() returns correct values', () => {
    const sim = makeEngine();
    const resource = new Resource<TestEvents>('server', { capacity: 2 });
    const snapshots: ReturnType<typeof resource.snapshot>[] = [];

    sim.on('start', (_e, ctx) => {
      snapshots.push(resource.snapshot()); // before any requests
      resource.request(ctx, (ctx) => {
        snapshots.push(resource.snapshot()); // after first grant
        resource.release(ctx);
        snapshots.push(resource.snapshot()); // after release
      });
    });

    sim.init((ctx) => ctx.schedule('start', 1, {}));
    sim.run();

    expect(snapshots[0]).toEqual({ name: 'server', capacity: 2, inUse: 0, queueLength: 0 });
    expect(snapshots[1]).toEqual({ name: 'server', capacity: 2, inUse: 1, queueLength: 0 });
    expect(snapshots[2]).toEqual({ name: 'server', capacity: 2, inUse: 0, queueLength: 0 });
  });

  it('multiple Resource instances with different names do not share state', () => {
    const sim = makeEngine();
    const r1 = new Resource<TestEvents>('r1');
    const r2 = new Resource<TestEvents>('r2');

    sim.on('start', (_e, ctx) => {
      r1.request(ctx, () => { /* holds r1 */ });
      r2.request(ctx, () => { /* holds r2 */ });
    });

    sim.init((ctx) => ctx.schedule('start', 1, {}));
    sim.run();

    expect(r1.inUse).toBe(1);
    expect(r2.inUse).toBe(1);
    expect(r1.queueLength).toBe(0);
    expect(r2.queueLength).toBe(0);
  });

  it('resource.reset() clears inUse, queue, and counter', () => {
    const sim = makeEngine();
    const resource = new Resource<TestEvents>('server', { capacity: 1 });

    sim.on('start', (_e, ctx) => {
      resource.request(ctx, () => { /* holds */ });
      resource.request(ctx, () => {});
      resource.request(ctx, () => {});
    });

    sim.init((ctx) => ctx.schedule('start', 1, {}));
    sim.run();

    expect(resource.inUse).toBe(1);
    expect(resource.queueLength).toBe(2);

    resource.reset();

    expect(resource.inUse).toBe(0);
    expect(resource.queueLength).toBe(0);
  });

  it('capacity = Infinity: all requests are granted immediately', () => {
    const sim = makeEngine();
    const resource = new Resource<TestEvents>('unlimited', { capacity: Infinity });
    let queuedAtAnyPoint = false;

    sim.on('start', (_e, ctx) => {
      for (let i = 0; i < 100; i++) {
        resource.request(ctx, (ctx) => { resource.release(ctx); });
        if (resource.queueLength > 0) queuedAtAnyPoint = true;
      }
    });

    sim.init((ctx) => ctx.schedule('start', 1, {}));
    sim.run();

    expect(queuedAtAnyPoint).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Integration: M/M/1 queue theory validation
// ---------------------------------------------------------------------------

describe('Resource — integration: M/M/1', () => {
  it('mean wait time ≈ ρ/(μ−λ) within ±30% for large N', () => {
    /**
     * M/M/1 queue: λ = 0.8, μ = 1.0 → ρ = 0.8
     * Theoretical mean wait in queue: Wq = ρ / (μ − λ) = 0.8 / 0.2 = 4.0
     */
    const lambda = 0.8;  // arrival rate
    const mu = 1.0;      // service rate
    const rho = lambda / mu;
    const theoreticalWq = rho / (mu - lambda); // = 4.0

    type MM1Events = {
      'job:arrive': { jobId: number };
      'job:done': Record<string, never>;
    };

    const sim = new SimulationEngine<MM1Events>({ seed: 42, maxEvents: 4000 });
    const server = new Resource<MM1Events>('server', { capacity: 1 });
    let jobCounter = 0;

    sim.on('job:arrive', (event, ctx) => {
      const { jobId } = event.payload;
      const arrivalTime = ctx.clock;

      server.request(ctx, (ctx) => {
        const waitTime = ctx.clock - arrivalTime;
        ctx.stats.record('waitTime', waitTime);
        const serviceTime = -Math.log(1 - ctx.random()) / mu;
        ctx.schedule('job:done', ctx.clock + serviceTime, {});
      });

      // Schedule next arrival
      const interArrival = -Math.log(1 - ctx.random()) / lambda;
      ctx.schedule('job:arrive', ctx.clock + interArrival, { jobId: ++jobCounter });
    });

    sim.on('job:done', (_e, ctx) => {
      server.release(ctx);
    });

    sim.init((ctx) => {
      ctx.schedule('job:arrive', 0, { jobId: ++jobCounter });
    });

    const result = sim.run();
    const measuredWq = result.stats['waitTime'].mean;

    // Allow ±30% tolerance for stochastic variance
    expect(measuredWq).toBeGreaterThan(theoreticalWq * 0.7);
    expect(measuredWq).toBeLessThan(theoreticalWq * 1.3);
  });
});
