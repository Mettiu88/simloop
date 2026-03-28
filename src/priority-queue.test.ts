import { describe, it, expect } from 'vitest';
import { PriorityQueue } from './priority-queue.js';
import type { SimEvent } from './types.js';

function makeEvent(time: number, type = 'test'): SimEvent {
  return {
    id: `e_${time}_${type}`,
    time,
    type,
    payload: undefined,
    createdAt: 0,
    cancelled: false,
  };
}

describe('PriorityQueue', () => {
  it('should dequeue events in time order', () => {
    const q = new PriorityQueue();
    q.enqueue(makeEvent(5));
    q.enqueue(makeEvent(1));
    q.enqueue(makeEvent(3));

    expect(q.dequeue()!.time).toBe(1);
    expect(q.dequeue()!.time).toBe(3);
    expect(q.dequeue()!.time).toBe(5);
  });

  it('should preserve FIFO order for same-time events', () => {
    const q = new PriorityQueue();
    q.enqueue(makeEvent(1, 'first'));
    q.enqueue(makeEvent(1, 'second'));
    q.enqueue(makeEvent(1, 'third'));

    expect(q.dequeue()!.type).toBe('first');
    expect(q.dequeue()!.type).toBe('second');
    expect(q.dequeue()!.type).toBe('third');
  });

  it('should report correct size', () => {
    const q = new PriorityQueue();
    expect(q.size).toBe(0);
    expect(q.isEmpty).toBe(true);

    q.enqueue(makeEvent(1));
    expect(q.size).toBe(1);
    expect(q.isEmpty).toBe(false);

    q.dequeue();
    expect(q.size).toBe(0);
    expect(q.isEmpty).toBe(true);
  });

  it('should peek without removing', () => {
    const q = new PriorityQueue();
    q.enqueue(makeEvent(5));
    q.enqueue(makeEvent(2));

    expect(q.peek()!.time).toBe(2);
    expect(q.size).toBe(2);
  });

  it('should return undefined from empty queue', () => {
    const q = new PriorityQueue();
    expect(q.dequeue()).toBeUndefined();
    expect(q.peek()).toBeUndefined();
  });

  it('should clear the queue', () => {
    const q = new PriorityQueue();
    q.enqueue(makeEvent(1));
    q.enqueue(makeEvent(2));
    q.clear();
    expect(q.size).toBe(0);
    expect(q.isEmpty).toBe(true);
  });

  it('should handle large number of events', () => {
    const q = new PriorityQueue();
    const N = 10000;

    for (let i = 0; i < N; i++) {
      q.enqueue(makeEvent(Math.random() * 1000));
    }

    let prevTime = -1;
    while (!q.isEmpty) {
      const event = q.dequeue()!;
      expect(event.time).toBeGreaterThanOrEqual(prevTime);
      prevTime = event.time;
    }
  });
});
