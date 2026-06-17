// Bounded FIFO for terminal scrollback (21-logs-and-console.md), copied from
// dockge's backend/utils/limit-queue.ts (MIT, see NOTICE): pushing beyond the
// cap evicts the oldest entry, so a late-joining client replays a fixed-size
// tail instead of unbounded history.
export class LimitQueue<T> {
  private items: T[] = [];

  constructor(private readonly limit: number) {}

  push(item: T): void {
    this.items.push(item);
    if (this.items.length > this.limit) this.items.shift();
  }

  toArray(): readonly T[] {
    return this.items;
  }

  get size(): number {
    return this.items.length;
  }
}
