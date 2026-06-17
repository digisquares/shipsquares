import { makeDriver } from "./engines/factory.js";
import type { ConnectionConfig, DbDriver, DriverFactory } from "./engines/types.js";

// A keyed pool of long-lived drivers (database-studio/01). One driver per
// resolved connection id, reused across requests; evicted on profile
// edit/delete (so the next request reconnects with fresh config). A soft cap
// closes the oldest entry to protect the control plane. Pure (injected factory)
// + unit-tested; `dbStudioPool` is the runtime instance over real drivers.

export interface DbStudioPool {
  acquire(id: string, config: ConnectionConfig): DbDriver;
  /** Drop + close the pooled driver for an id; awaitable so callers that need
   *  the connection truly gone (e.g. before DROP DATABASE) can wait. */
  evict(id: string): Promise<void>;
  size(): number;
  closeAll(): Promise<void>;
}

export function createDbStudioPool(make: DriverFactory, opts: { max?: number } = {}): DbStudioPool {
  const max = opts.max ?? 25;
  const drivers = new Map<string, DbDriver>();

  function evict(id: string): Promise<void> {
    const d = drivers.get(id);
    if (!d) return Promise.resolve();
    drivers.delete(id);
    return Promise.resolve(d.close()).catch(() => undefined);
  }

  function acquire(id: string, config: ConnectionConfig): DbDriver {
    const existing = drivers.get(id);
    if (existing) return existing;
    if (drivers.size >= max) {
      const oldest = drivers.keys().next().value;
      if (oldest !== undefined) void evict(oldest);
    }
    const driver = make(config);
    drivers.set(id, driver);
    return driver;
  }

  async function closeAll(): Promise<void> {
    const all = [...drivers.values()];
    drivers.clear();
    await Promise.allSettled(all.map((d) => d.close()));
  }

  return { acquire, evict, size: () => drivers.size, closeAll };
}

/** The process-wide pool every Database Studio request shares. */
export const dbStudioPool: DbStudioPool = createDbStudioPool(makeDriver);
