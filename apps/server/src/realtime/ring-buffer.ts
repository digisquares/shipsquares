// Bounded per-deployment ring buffer (12-realtime-logs.md). Reimplements Dockge's
// LimitQueue semantics (backend/utils/limit-queue.ts, MIT): the oldest element is
// dropped once `max` is exceeded, with an optional `onExceed` callback for the
// evicted item. Holds the last `max` frames so a client connecting mid-deploy gets
// an immediate replay tail before live frames. (Composition over Dockge's
// Array-subclass + `pushItem`; same behaviour, cleaner types.) Pure.
export class LimitQueue<T> {
  private readonly items: T[] = [];

  /** called with each evicted (oldest) item when the cap is exceeded. */
  onExceed?: (item: T) => void;

  constructor(private readonly max: number) {
    if (max < 1) throw new Error("LimitQueue max must be >= 1");
  }

  push(item: T): void {
    this.items.push(item);
    while (this.items.length > this.max) {
      const dropped = this.items.shift();
      if (dropped !== undefined) this.onExceed?.(dropped);
    }
  }

  toArray(): T[] {
    return [...this.items];
  }

  get size(): number {
    return this.items.length;
  }

  clear(): void {
    this.items.length = 0;
  }
}
