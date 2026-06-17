import { describe, expect, it, vi } from "vitest";

import type { ConnectionConfig, DbDriver } from "./engines/types.js";
import { createDbStudioPool } from "./pool.js";

const cfg = (host: string): ConnectionConfig => ({
  engine: "postgres",
  host,
  port: 5432,
  database: "d",
  user: "u",
  password: "p",
  tls: true,
  readOnly: true,
  statementTimeoutMs: 15_000,
  maxRows: 1000,
});

function fakeDriver(): DbDriver & { closed: () => number } {
  const close = vi.fn(async () => undefined);
  return {
    engine: "postgres",
    query: async () => ({ fields: [], rows: [], rowCount: 0, command: "" }),
    transaction: async () => [],
    ping: async () => ({ serverVersion: "x" }),
    close,
    closed: () => close.mock.calls.length,
  };
}

describe("createDbStudioPool", () => {
  it("caches one driver per id and reuses it", () => {
    const make = vi.fn(() => fakeDriver());
    const pool = createDbStudioPool(make);
    const a = pool.acquire("ext:1", cfg("a"));
    const b = pool.acquire("ext:1", cfg("a"));
    expect(a).toBe(b);
    expect(make).toHaveBeenCalledTimes(1);
    expect(pool.size()).toBe(1);
  });

  it("evict closes the driver and drops it so the next acquire reconnects", async () => {
    const drivers: ReturnType<typeof fakeDriver>[] = [];
    const make = vi.fn(() => {
      const d = fakeDriver();
      drivers.push(d);
      return d;
    });
    const pool = createDbStudioPool(make);
    pool.acquire("ext:1", cfg("a"));
    await pool.evict("ext:1");
    expect(drivers[0]!.closed()).toBe(1);
    expect(pool.size()).toBe(0);
    pool.acquire("ext:1", cfg("a"));
    expect(make).toHaveBeenCalledTimes(2);
  });

  it("enforces the soft cap by evicting the oldest entry", () => {
    const make = vi.fn(() => fakeDriver());
    const pool = createDbStudioPool(make, { max: 2 });
    const first = pool.acquire("ext:1", cfg("a"));
    pool.acquire("ext:2", cfg("b"));
    pool.acquire("ext:3", cfg("c")); // evicts ext:1 (oldest)
    expect(pool.size()).toBe(2);
    expect((first as DbDriver & { closed: () => number }).closed()).toBe(1);
  });

  it("closeAll closes every driver and empties the pool", async () => {
    const made: ReturnType<typeof fakeDriver>[] = [];
    const pool = createDbStudioPool(() => {
      const d = fakeDriver();
      made.push(d);
      return d;
    });
    pool.acquire("ext:1", cfg("a"));
    pool.acquire("ext:2", cfg("b"));
    await pool.closeAll();
    expect(pool.size()).toBe(0);
    expect(made.every((d) => d.closed() === 1)).toBe(true);
  });
});
