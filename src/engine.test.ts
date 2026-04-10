import { describe, it, expect } from 'vitest';
import { SimulationEngine, SimulationError } from './engine.js';

type TestEvents = {
  ping: { message: string };
  pong: { reply: string };
  tick: Record<string, never>;
};

describe('SimulationEngine', () => {
  describe('basic lifecycle', () => {
    it('should start in idle state', () => {
      const sim = new SimulationEngine<TestEvents>();
      expect(sim.status).toBe('idle');
      expect(sim.clock).toBe(0);
    });

    it('should run and finish when queue is empty', () => {
      const sim = new SimulationEngine<TestEvents>();
      sim.on('ping', () => {});
      sim.init((ctx) => {
        ctx.schedule('ping', 1, { message: 'hello' });
      });

      const result = sim.run();
      expect(result.status).toBe('finished');
      expect(result.totalEventsProcessed).toBe(1);
      expect(sim.status).toBe('finished');
    });

    it('should advance clock to event time', () => {
      const sim = new SimulationEngine<TestEvents>();
      const times: number[] = [];

      sim.on('ping', (_e, ctx) => {
        times.push(ctx.clock);
      });

      sim.init((ctx) => {
        ctx.schedule('ping', 5, { message: 'a' });
        ctx.schedule('ping', 10, { message: 'b' });
        ctx.schedule('ping', 15, { message: 'c' });
      });

      sim.run();
      expect(times).toEqual([5, 10, 15]);
    });

    it('should stop at maxTime', () => {
      const sim = new SimulationEngine<TestEvents>({ maxTime: 50 });
      let count = 0;

      sim.on('tick', (_e, ctx) => {
        count++;
        ctx.schedule('tick', ctx.clock + 10, {});
      });

      sim.init((ctx) => {
        ctx.schedule('tick', 0, {});
      });

      const result = sim.run();
      expect(count).toBe(6); // t=0,10,20,30,40,50
      expect(result.status).toBe('maxTimeReached');
    });

    it('should stop at maxEvents', () => {
      const sim = new SimulationEngine<TestEvents>({ maxEvents: 3 });

      sim.on('tick', (_e, ctx) => {
        ctx.schedule('tick', ctx.clock + 1, {});
      });

      sim.init((ctx) => {
        ctx.schedule('tick', 0, {});
      });

      const result = sim.run();
      expect(result.totalEventsProcessed).toBe(3);
      expect(result.status).toBe('maxEventsReached');
    });
  });

  describe('event handling', () => {
    it('should dispatch events to correct handlers', () => {
      const sim = new SimulationEngine<TestEvents>();
      const log: string[] = [];

      sim.on('ping', (e) => log.push(`ping:${e.payload.message}`));
      sim.on('pong', (e) => log.push(`pong:${e.payload.reply}`));

      sim.init((ctx) => {
        ctx.schedule('pong', 2, { reply: 'world' });
        ctx.schedule('ping', 1, { message: 'hello' });
      });

      sim.run();
      expect(log).toEqual(['ping:hello', 'pong:world']);
    });

    it('should handle dynamic event scheduling', () => {
      const sim = new SimulationEngine<TestEvents>();
      const log: string[] = [];

      sim.on('ping', (e, ctx) => {
        log.push(e.payload.message);
        if (e.payload.message === 'first') {
          ctx.schedule('ping', ctx.clock + 5, { message: 'second' });
        }
      });

      sim.init((ctx) => {
        ctx.schedule('ping', 1, { message: 'first' });
      });

      sim.run();
      expect(log).toEqual(['first', 'second']);
    });

    it('should throw when scheduling in the past', () => {
      const sim = new SimulationEngine<TestEvents>();

      sim.on('ping', (_e, ctx) => {
        expect(() => {
          ctx.schedule('ping', ctx.clock - 1, { message: 'bad' });
        }).toThrow(SimulationError);
      });

      sim.init((ctx) => {
        ctx.schedule('ping', 10, { message: 'test' });
      });

      sim.run();
    });

    it('should support event cancellation', () => {
      const sim = new SimulationEngine<TestEvents>();
      const log: string[] = [];

      sim.on('ping', (e) => log.push(e.payload.message));

      sim.init((ctx) => {
        ctx.schedule('ping', 1, { message: 'keep' });
        const toCancel = ctx.schedule('ping', 2, { message: 'cancel-me' });
        ctx.cancelEvent(toCancel);
        ctx.schedule('ping', 3, { message: 'also-keep' });
      });

      const result = sim.run();
      expect(log).toEqual(['keep', 'also-keep']);
      expect(result.totalEventsCancelled).toBe(1);
      expect(result.totalEventsProcessed).toBe(2);
    });
  });

  describe('entity management', () => {
    it('should add, get, and remove entities', () => {
      const sim = new SimulationEngine<TestEvents>();

      sim.on('ping', (_e, ctx) => {
        ctx.addEntity({ id: 'e1', state: { x: 1 } });
        const entity = ctx.getEntity<{ x: number }>('e1');
        expect(entity).toBeDefined();
        expect(entity!.state.x).toBe(1);

        ctx.removeEntity('e1');
        expect(ctx.getEntity('e1')).toBeUndefined();
      });

      sim.init((ctx) => {
        ctx.schedule('ping', 1, { message: 'test' });
      });

      sim.run();
    });

    it('should list all entities', () => {
      const sim = new SimulationEngine<TestEvents>();

      sim.on('ping', (_e, ctx) => {
        const all = ctx.getAllEntities();
        expect(all).toHaveLength(2);
      });

      sim.init((ctx) => {
        ctx.addEntity({ id: 'a', state: {} });
        ctx.addEntity({ id: 'b', state: {} });
        ctx.schedule('ping', 1, { message: 'test' });
      });

      sim.run();
    });
  });

  describe('hooks', () => {
    it('should call beforeEach and afterEach hooks', () => {
      const sim = new SimulationEngine<TestEvents>();
      const log: string[] = [];

      sim.beforeEach((e) => log.push(`before:${e.type}`));
      sim.afterEach((e) => log.push(`after:${e.type}`));
      sim.on('ping', () => log.push('handler'));

      sim.init((ctx) => {
        ctx.schedule('ping', 1, { message: 'test' });
      });

      sim.run();
      expect(log).toEqual(['before:ping', 'handler', 'after:ping']);
    });

    it('should call onEnd hook', () => {
      const sim = new SimulationEngine<TestEvents>();
      let endCalled = false;

      sim.onEnd(() => {
        endCalled = true;
      });
      sim.on('ping', () => {});

      sim.init((ctx) => {
        ctx.schedule('ping', 1, { message: 'test' });
      });

      sim.run();
      expect(endCalled).toBe(true);
    });
  });

  describe('statistics', () => {
    it('should collect stats from handlers', () => {
      const sim = new SimulationEngine<TestEvents>();

      sim.on('ping', (_e, ctx) => {
        ctx.stats.record('latency', ctx.clock * 2);
        ctx.stats.increment('count');
      });

      sim.init((ctx) => {
        ctx.schedule('ping', 5, { message: 'a' });
        ctx.schedule('ping', 10, { message: 'b' });
      });

      const result = sim.run();
      expect(result.stats['count'].count).toBe(2);
      expect(result.stats['latency'].mean).toBe(15);
    });
  });

  describe('determinism', () => {
    it('should produce identical results with the same seed', () => {
      function runSim(seed: number) {
        const sim = new SimulationEngine<TestEvents>({ seed, maxEvents: 100 });
        const values: number[] = [];

        sim.on('tick', (_e, ctx) => {
          const r = ctx.random();
          values.push(r);
          ctx.schedule('tick', ctx.clock + r, {});
        });

        sim.init((ctx) => {
          ctx.schedule('tick', 0, {});
        });

        sim.run();
        return values;
      }

      const run1 = runSim(42);
      const run2 = runSim(42);
      expect(run1).toEqual(run2);

      const run3 = runSim(99);
      expect(run1).not.toEqual(run3);
    });
  });

  describe('lifecycle errors', () => {
    it('should throw on invalid state transitions', () => {
      const sim = new SimulationEngine<TestEvents>();
      sim.on('ping', () => {});
      sim.init((ctx) => ctx.schedule('ping', 1, { message: '' }));

      // Can't pause before running
      expect(() => sim.pause()).toThrow(SimulationError);

      // Can't resume before pausing
      expect(() => sim.resume()).toThrow(SimulationError);

      // Can't reset before finishing
      expect(() => sim.reset()).toThrow(SimulationError);
    });

    it('should support reset and re-run', () => {
      const sim = new SimulationEngine<TestEvents>({ seed: 42 });

      sim.on('ping', () => {});
      sim.init((ctx) => ctx.schedule('ping', 5, { message: 'hello' }));

      const r1 = sim.run();
      expect(r1.totalEventsProcessed).toBe(1);

      sim.reset();
      sim.init((ctx) => ctx.schedule('ping', 10, { message: 'world' }));

      const r2 = sim.run();
      expect(r2.totalEventsProcessed).toBe(1);
      expect(r2.finalClock).toBe(10);
    });

    it('should not allow init after run without reset', () => {
      const sim = new SimulationEngine<TestEvents>();
      sim.on('ping', () => {});
      sim.init((ctx) => ctx.schedule('ping', 1, { message: '' }));
      sim.run();

      expect(() => sim.init(() => {})).toThrow(SimulationError);
    });
  });

  describe('async run', () => {
    it('should produce the same result as sync run', async () => {
      const sim = new SimulationEngine<TestEvents>({ seed: 42, maxEvents: 50 });
      const values: number[] = [];

      sim.on('tick', (_e, ctx) => {
        values.push(ctx.random());
        ctx.schedule('tick', ctx.clock + 1, {});
      });

      sim.init((ctx) => ctx.schedule('tick', 0, {}));
      const asyncResult = await sim.runAsync();

      const sim2 = new SimulationEngine<TestEvents>({ seed: 42, maxEvents: 50 });
      const values2: number[] = [];

      sim2.on('tick', (_e, ctx) => {
        values2.push(ctx.random());
        ctx.schedule('tick', ctx.clock + 1, {});
      });

      sim2.init((ctx) => ctx.schedule('tick', 0, {}));
      const syncResult = sim2.run();

      expect(values).toEqual(values2);
      expect(asyncResult.totalEventsProcessed).toBe(syncResult.totalEventsProcessed);
      expect(asyncResult.finalClock).toBe(syncResult.finalClock);
    });
  });

  describe('ctx.dist', () => {
    it('should expose dist on the context with all distribution methods', () => {
      const sim = new SimulationEngine<TestEvents>({ seed: 42 });
      let hasDist = false;

      sim.on('ping', (_event, ctx) => {
        hasDist = ctx.dist !== undefined
          && typeof ctx.dist.exponential === 'function'
          && typeof ctx.dist.gaussian === 'function'
          && typeof ctx.dist.uniform === 'function';
      });

      sim.init((ctx) => ctx.schedule('ping', 0, { message: 'test' }));
      sim.run();

      expect(hasDist).toBe(true);
    });

    it('should produce deterministic samples with seeded engine', () => {
      const values: number[] = [];

      for (let run = 0; run < 2; run++) {
        const sim = new SimulationEngine<TestEvents>({ seed: 123 });
        sim.on('ping', (_event, ctx) => {
          values.push(ctx.dist.exponential(2)());
        });
        sim.init((ctx) => ctx.schedule('ping', 0, { message: 'test' }));
        sim.run();
      }

      expect(values[0]).toBe(values[1]);
    });
  });

  describe('warm-up period', () => {
    it('should reset stats when clock crosses warmUpTime', () => {
      const sim = new SimulationEngine<TestEvents>({ seed: 42, warmUpTime: 5 });

      sim.on('ping', (_event, ctx) => {
        ctx.stats.increment('count');
      });

      sim.init((ctx) => {
        ctx.schedule('ping', 1, { message: 'during warm-up' });
        ctx.schedule('ping', 3, { message: 'during warm-up' });
        ctx.schedule('ping', 7, { message: 'after warm-up' });
        ctx.schedule('ping', 10, { message: 'after warm-up' });
      });

      const result = sim.run();

      // Only the 2 events after warmUpTime=5 should be counted
      expect(result.stats['count'].count).toBe(2);
    });

    it('should set warmUpCompleted to false during warm-up and true after', () => {
      const flags: boolean[] = [];
      const sim = new SimulationEngine<TestEvents>({ seed: 42, warmUpTime: 5 });

      sim.on('ping', (_event, ctx) => {
        flags.push(ctx.warmUpCompleted);
      });

      sim.init((ctx) => {
        ctx.schedule('ping', 2, { message: 'during' });
        ctx.schedule('ping', 8, { message: 'after' });
      });

      sim.run();

      expect(flags).toEqual([false, true]);
    });

    it('should have warmUpCompleted = true when no warmUpTime is set', () => {
      let flag = false;
      const sim = new SimulationEngine<TestEvents>({ seed: 42 });

      sim.on('ping', (_event, ctx) => {
        flag = ctx.warmUpCompleted;
      });

      sim.init((ctx) => ctx.schedule('ping', 1, { message: 'test' }));
      sim.run();

      expect(flag).toBe(true);
    });

    it('should reset warmUpCompleted on engine reset', () => {
      const flags: boolean[] = [];
      const sim = new SimulationEngine<TestEvents>({ seed: 42, warmUpTime: 5 });

      sim.on('ping', (_event, ctx) => {
        flags.push(ctx.warmUpCompleted);
      });

      sim.init((ctx) => {
        ctx.schedule('ping', 2, { message: 'during' });
        ctx.schedule('ping', 8, { message: 'after' });
      });
      sim.run();

      // Reset and re-run — warm-up should trigger again
      sim.reset();
      sim.init((ctx) => {
        ctx.schedule('ping', 3, { message: 'during again' });
        ctx.schedule('ping', 9, { message: 'after again' });
      });
      sim.run();

      expect(flags).toEqual([false, true, false, true]);
    });
  });

  describe('custom stop conditions (stopWhen)', () => {
    it('should stop when stopWhen returns true', () => {
      const sim = new SimulationEngine<TestEvents>({
        stopWhen: (ctx) => ctx.stats.get('count').sum >= 3,
      });

      sim.on('tick', (_e, ctx) => {
        ctx.stats.record('count', 1);
        ctx.schedule('tick', ctx.clock + 1, {});
      });

      sim.init((ctx) => {
        ctx.schedule('tick', 0, {});
      });

      const result = sim.run();
      expect(result.status).toBe('stopConditionMet');
      expect(result.totalEventsProcessed).toBe(3);
    });

    it('should provide updated context to stopWhen', () => {
      const clocks: number[] = [];

      const sim = new SimulationEngine<TestEvents, { total: number }>({
        store: { total: 0 },
        stopWhen: (ctx) => {
          clocks.push(ctx.clock);
          return ctx.store.total >= 30;
        },
      });

      sim.on('tick', (_e, ctx) => {
        ctx.store.total += 10;
        ctx.schedule('tick', ctx.clock + 5, {});
      });

      sim.init((ctx) => {
        ctx.schedule('tick', 0, {});
      });

      const result = sim.run();
      expect(result.status).toBe('stopConditionMet');
      expect(clocks).toEqual([0, 5, 10]);
      expect(result.store.total).toBe(30);
    });

    it('should return maxTimeReached when maxTime triggers before stopWhen', () => {
      const sim = new SimulationEngine<TestEvents>({
        maxTime: 20,
        stopWhen: () => false, // never triggers
      });

      sim.on('tick', (_e, ctx) => {
        ctx.schedule('tick', ctx.clock + 10, {});
      });

      sim.init((ctx) => {
        ctx.schedule('tick', 0, {});
      });

      const result = sim.run();
      expect(result.status).toBe('maxTimeReached');
    });

    it('should return maxEventsReached when maxEvents triggers before stopWhen', () => {
      const sim = new SimulationEngine<TestEvents>({
        maxEvents: 2,
        stopWhen: () => false,
      });

      sim.on('tick', (_e, ctx) => {
        ctx.schedule('tick', ctx.clock + 1, {});
      });

      sim.init((ctx) => {
        ctx.schedule('tick', 0, {});
      });

      const result = sim.run();
      expect(result.status).toBe('maxEventsReached');
    });

    it('should process the event that triggers the stop condition', () => {
      let processed = 0;

      const sim = new SimulationEngine<TestEvents>({
        stopWhen: (ctx) => ctx.clock >= 10,
      });

      sim.on('tick', (_e, ctx) => {
        processed++;
        ctx.schedule('tick', ctx.clock + 5, {});
      });

      sim.init((ctx) => {
        ctx.schedule('tick', 0, {});
      });

      const result = sim.run();
      expect(result.status).toBe('stopConditionMet');
      // Events at t=0,5,10 — the event at t=10 IS processed
      expect(processed).toBe(3);
      expect(result.finalClock).toBe(10);
    });

    it('should work with runAsync', async () => {
      const sim = new SimulationEngine<TestEvents>({
        stopWhen: (ctx) => ctx.stats.get('count').sum >= 3,
      });

      sim.on('tick', (_e, ctx) => {
        ctx.stats.record('count', 1);
        ctx.schedule('tick', ctx.clock + 1, {});
      });

      sim.init((ctx) => {
        ctx.schedule('tick', 0, {});
      });

      const result = await sim.runAsync();
      expect(result.status).toBe('stopConditionMet');
      expect(result.totalEventsProcessed).toBe(3);
    });

    it('should reset stopConditionMet flag on reset', () => {
      const sim = new SimulationEngine<TestEvents>({
        stopWhen: (ctx) => ctx.clock >= 5,
      });

      sim.on('tick', (_e, ctx) => {
        ctx.schedule('tick', ctx.clock + 5, {});
      });

      sim.init((ctx) => {
        ctx.schedule('tick', 0, {});
      });

      const result1 = sim.run();
      expect(result1.status).toBe('stopConditionMet');

      sim.reset();
      sim.init((ctx) => {
        ctx.schedule('tick', 0, {});
      });

      const result2 = sim.run();
      expect(result2.status).toBe('stopConditionMet');
    });
  });
});
