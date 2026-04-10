import { describe, it, expect } from 'vitest';
import { SimulationEngine } from './engine.js';
import { Queue } from './queue.js';

type TestEvents = {
  produce: { item: string };
  consume: Record<string, never>;
};

describe('Queue', () => {
  // Helper: run a single event that calls `fn` with ctx, then return result
  function withCtx(fn: (ctx: any) => void): void {
    const sim = new SimulationEngine<TestEvents>({ logLevel: 'silent' });
    sim.on('produce', (_e, ctx) => fn(ctx));
    sim.init((ctx) => ctx.schedule('produce', 0, { item: '' }));
    sim.run();
  }

  describe('basic FIFO', () => {
    it('should dequeue items in insertion order', () => {
      const q = new Queue<string>('buf');
      const items: string[] = [];

      withCtx((ctx) => {
        q.enqueue(ctx, 'a');
        q.enqueue(ctx, 'b');
        q.enqueue(ctx, 'c');
        items.push(q.dequeue(ctx)!);
        items.push(q.dequeue(ctx)!);
        items.push(q.dequeue(ctx)!);
      });

      expect(items).toEqual(['a', 'b', 'c']);
    });
  });

  describe('priority ordering', () => {
    it('should dequeue lower priority number first', () => {
      const q = new Queue<string>('buf');
      const items: string[] = [];

      withCtx((ctx) => {
        q.enqueue(ctx, 'low', { priority: 10 });
        q.enqueue(ctx, 'high', { priority: 1 });
        q.enqueue(ctx, 'mid', { priority: 5 });
        items.push(q.dequeue(ctx)!);
        items.push(q.dequeue(ctx)!);
        items.push(q.dequeue(ctx)!);
      });

      expect(items).toEqual(['high', 'mid', 'low']);
    });

    it('should use FIFO within same priority', () => {
      const q = new Queue<string>('buf');
      const items: string[] = [];

      withCtx((ctx) => {
        q.enqueue(ctx, 'first', { priority: 1 });
        q.enqueue(ctx, 'second', { priority: 1 });
        q.enqueue(ctx, 'third', { priority: 1 });
        items.push(q.dequeue(ctx)!);
        items.push(q.dequeue(ctx)!);
        items.push(q.dequeue(ctx)!);
      });

      expect(items).toEqual(['first', 'second', 'third']);
    });
  });

  describe('peek', () => {
    it('should return front item without removing it', () => {
      const q = new Queue<string>('buf');

      withCtx((ctx) => {
        q.enqueue(ctx, 'a');
        q.enqueue(ctx, 'b');
        expect(q.peek()).toBe('a');
        expect(q.length).toBe(2);
      });
    });

    it('should return undefined on empty queue', () => {
      const q = new Queue<string>('buf');
      expect(q.peek()).toBeUndefined();
    });
  });

  describe('accessors', () => {
    it('should track length, isEmpty, isFull', () => {
      const q = new Queue<number>('buf', { maxCapacity: 2 });

      expect(q.isEmpty).toBe(true);
      expect(q.isFull).toBe(false);
      expect(q.length).toBe(0);

      withCtx((ctx) => {
        q.enqueue(ctx, 1);
        expect(q.length).toBe(1);
        expect(q.isEmpty).toBe(false);
        expect(q.isFull).toBe(false);

        q.enqueue(ctx, 2);
        expect(q.length).toBe(2);
        expect(q.isFull).toBe(true);
      });
    });
  });

  describe('unbounded queue', () => {
    it('should never be full with default maxCapacity', () => {
      const q = new Queue<number>('buf');

      withCtx((ctx) => {
        for (let i = 0; i < 1000; i++) {
          expect(q.enqueue(ctx, i)).toBe(true);
        }
        expect(q.isFull).toBe(false);
        expect(q.length).toBe(1000);
      });
    });
  });

  describe('bounded + drop policy', () => {
    it('should drop items when full and return false', () => {
      const q = new Queue<string>('buf', { maxCapacity: 2, overflowPolicy: 'drop' });

      withCtx((ctx) => {
        expect(q.enqueue(ctx, 'a')).toBe(true);
        expect(q.enqueue(ctx, 'b')).toBe(true);
        expect(q.enqueue(ctx, 'c')).toBe(false); // dropped
        expect(q.length).toBe(2);
      });
    });

    it('should increment dropped stat', () => {
      const sim = new SimulationEngine<TestEvents>({ seed: 1, logLevel: 'silent' });
      const q = new Queue<string>('buf', { maxCapacity: 1 });

      sim.on('produce', (_e, ctx) => {
        q.enqueue(ctx, 'a');
        q.enqueue(ctx, 'b'); // dropped
        q.enqueue(ctx, 'c'); // dropped
      });

      sim.init((ctx) => ctx.schedule('produce', 0, { item: '' }));
      const result = sim.run();

      expect(result.stats['queue.buf.dropped'].count).toBe(2);
    });
  });

  describe('bounded + block policy', () => {
    it('should block items when full and admit on dequeue', () => {
      const q = new Queue<string>('buf', { maxCapacity: 2, overflowPolicy: 'block' });

      withCtx((ctx) => {
        q.enqueue(ctx, 'a');
        q.enqueue(ctx, 'b');
        expect(q.enqueue(ctx, 'c')).toBe(false); // blocked
        expect(q.length).toBe(2);

        const item = q.dequeue(ctx);
        expect(item).toBe('a');
        // 'c' should now be admitted
        expect(q.length).toBe(2); // 'b' + 'c'
        expect(q.dequeue(ctx)).toBe('b');
        expect(q.dequeue(ctx)).toBe('c');
      });
    });

    it('should record blockTime stat', () => {
      const sim = new SimulationEngine<TestEvents>({ seed: 1, logLevel: 'silent' });
      const q = new Queue<string>('buf', { maxCapacity: 1, overflowPolicy: 'block' });

      sim.on('produce', (event, ctx) => {
        if (event.payload.item === 'first') {
          q.enqueue(ctx, 'a');
          q.enqueue(ctx, 'b'); // blocked at t=0
          ctx.schedule('produce', ctx.clock + 10, { item: 'second' });
        } else {
          q.dequeue(ctx); // at t=10, admits 'b', blockTime = 10
        }
      });

      sim.init((ctx) => ctx.schedule('produce', 0, { item: 'first' }));
      const result = sim.run();

      expect(result.stats['queue.buf.blocked'].count).toBe(1);
      expect(result.stats['queue.buf.blockTime'].mean).toBe(10);
    });
  });

  describe('stats collection', () => {
    it('should record all stats correctly', () => {
      const sim = new SimulationEngine<TestEvents>({ seed: 1, logLevel: 'silent' });
      const q = new Queue<string>('buf');

      sim.on('produce', (_e, ctx) => {
        q.enqueue(ctx, 'a');
        q.enqueue(ctx, 'b');
        ctx.schedule('consume', ctx.clock + 5, {});
      });

      sim.on('consume', (_e, ctx) => {
        q.dequeue(ctx);
      });

      sim.init((ctx) => ctx.schedule('produce', 0, { item: '' }));
      const result = sim.run();

      expect(result.stats['queue.buf.enqueued'].count).toBe(2);
      expect(result.stats['queue.buf.dequeued'].count).toBe(1);
      expect(result.stats['queue.buf.throughput'].count).toBe(1);
    });
  });

  describe('waitTime', () => {
    it('should record time between enqueue and dequeue', () => {
      const sim = new SimulationEngine<TestEvents>({ seed: 1, logLevel: 'silent' });
      const q = new Queue<string>('buf');

      sim.on('produce', (_e, ctx) => {
        q.enqueue(ctx, 'a');
        ctx.schedule('consume', ctx.clock + 7, {});
      });

      sim.on('consume', (_e, ctx) => {
        q.dequeue(ctx);
      });

      sim.init((ctx) => ctx.schedule('produce', 0, { item: '' }));
      const result = sim.run();

      expect(result.stats['queue.buf.waitTime'].mean).toBe(7);
    });
  });

  describe('dequeue from empty', () => {
    it('should return undefined', () => {
      const q = new Queue<string>('buf');

      withCtx((ctx) => {
        expect(q.dequeue(ctx)).toBeUndefined();
      });
    });
  });

  describe('snapshot', () => {
    it('should return correct state', () => {
      const q = new Queue<string>('buf', { maxCapacity: 5 });

      withCtx((ctx) => {
        q.enqueue(ctx, 'a');
        q.enqueue(ctx, 'b');

        const snap = q.snapshot();
        expect(snap.name).toBe('buf');
        expect(snap.maxCapacity).toBe(5);
        expect(snap.length).toBe(2);
        expect(snap.items).toEqual(['a', 'b']);
      });
    });
  });

  describe('reset', () => {
    it('should clear all internal state', () => {
      const q = new Queue<string>('buf', { maxCapacity: 2, overflowPolicy: 'block' });

      withCtx((ctx) => {
        q.enqueue(ctx, 'a');
        q.enqueue(ctx, 'b');
        q.enqueue(ctx, 'c'); // blocked
      });

      expect(q.length).toBe(2);

      q.reset();

      expect(q.length).toBe(0);
      expect(q.isEmpty).toBe(true);
      expect(q.peek()).toBeUndefined();
    });
  });

  describe('custom statsPrefix', () => {
    it('should use custom prefix for stats', () => {
      const sim = new SimulationEngine<TestEvents>({ seed: 1, logLevel: 'silent' });
      const q = new Queue<string>('buf', { statsPrefix: 'myprefix' });

      sim.on('produce', (_e, ctx) => {
        q.enqueue(ctx, 'a');
        q.dequeue(ctx);
      });

      sim.init((ctx) => ctx.schedule('produce', 0, { item: '' }));
      const result = sim.run();

      expect(result.stats['queue.myprefix.enqueued'].count).toBe(1);
      expect(result.stats['queue.myprefix.dequeued'].count).toBe(1);
    });
  });

  describe('constructor validation', () => {
    it('should throw for invalid maxCapacity', () => {
      expect(() => new Queue('buf', { maxCapacity: 0 })).toThrow();
      expect(() => new Queue('buf', { maxCapacity: -1 })).toThrow();
    });
  });

  describe('integration', () => {
    it('should work within a full simulation run', () => {
      const sim = new SimulationEngine<TestEvents>({ seed: 42, maxEvents: 20, logLevel: 'silent' });
      const q = new Queue<string>('pipeline', { maxCapacity: 3, overflowPolicy: 'drop' });
      const consumed: string[] = [];

      sim.on('produce', (event, ctx) => {
        q.enqueue(ctx, event.payload.item);
        const nextId = `item-${ctx.stats.get('queue.pipeline.enqueued').count + ctx.stats.get('queue.pipeline.dropped').count + 1}`;
        ctx.schedule('produce', ctx.clock + 1, { item: nextId });
      });

      sim.on('consume', (_e, ctx) => {
        const item = q.dequeue(ctx);
        if (item !== undefined) consumed.push(item);
        ctx.schedule('consume', ctx.clock + 3, {});
      });

      sim.init((ctx) => {
        ctx.schedule('produce', 0, { item: 'item-1' });
        ctx.schedule('consume', 1, {});
      });

      const result = sim.run();

      expect(result.totalEventsProcessed).toBe(20);
      expect(consumed.length).toBeGreaterThan(0);
      expect(result.stats['queue.pipeline.enqueued']).toBeDefined();
    });
  });
});
