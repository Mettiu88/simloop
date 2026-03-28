import type { SimEvent } from './types.js';

interface QueueEntry {
  event: SimEvent;
  insertionOrder: number;
}

/**
 * Binary min-heap priority queue for simulation events.
 * Sorted by (time ASC, insertionOrder ASC) for deterministic FIFO behavior.
 */
export class PriorityQueue {
  private heap: QueueEntry[] = [];
  private counter = 0;

  get size(): number {
    return this.heap.length;
  }

  get isEmpty(): boolean {
    return this.heap.length === 0;
  }

  enqueue(event: SimEvent): void {
    const entry: QueueEntry = { event, insertionOrder: this.counter++ };
    this.heap.push(entry);
    this.siftUp(this.heap.length - 1);
  }

  dequeue(): SimEvent | undefined {
    if (this.heap.length === 0) return undefined;

    const min = this.heap[0];
    const last = this.heap.pop()!;

    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.siftDown(0);
    }

    return min.event;
  }

  peek(): SimEvent | undefined {
    return this.heap[0]?.event;
  }

  clear(): void {
    this.heap = [];
    this.counter = 0;
  }

  private siftUp(index: number): void {
    const entry = this.heap[index];
    while (index > 0) {
      const parentIndex = (index - 1) >> 1;
      const parent = this.heap[parentIndex];
      if (this.compare(entry, parent) >= 0) break;
      this.heap[index] = parent;
      index = parentIndex;
    }
    this.heap[index] = entry;
  }

  private siftDown(index: number): void {
    const length = this.heap.length;
    const entry = this.heap[index];

    while (true) {
      const left = 2 * index + 1;
      const right = 2 * index + 2;
      let smallest = index;

      if (left < length && this.compare(this.heap[left], this.heap[smallest]) < 0) {
        smallest = left;
      }
      if (right < length && this.compare(this.heap[right], this.heap[smallest]) < 0) {
        smallest = right;
      }

      if (smallest === index) break;

      this.heap[index] = this.heap[smallest];
      this.heap[smallest] = entry;
      index = smallest;
    }
  }

  private compare(a: QueueEntry, b: QueueEntry): number {
    const timeDiff = a.event.time - b.event.time;
    if (timeDiff !== 0) return timeDiff;
    return a.insertionOrder - b.insertionOrder;
  }
}
