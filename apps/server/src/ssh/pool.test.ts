import { describe, expect, it, vi } from "vitest";

import { createSshPool, type PooledClient } from "./pool.js";

const target = (host: string) => ({ host, username: "root", privateKey: "PEM" });

function fakeClient(over: Partial<PooledClient> = {}): PooledClient & { closed: () => void } {
  let onClosed: () => void = () => undefined;
  const client: PooledClient = {
    exec: vi.fn(async () => ({ code: 0, lines: [] })),
    end: vi.fn(),
    onClosed: (cb) => {
      onClosed = cb;
    },
    ...over,
  };
  return { ...client, closed: () => onClosed() };
}

describe("createSshPool", () => {
  it("reuses one connection per target across execs", async () => {
    const client = fakeClient();
    const connect = vi.fn(async () => client);
    const pool = createSshPool(connect);
    await pool.exec(target("a"), "uptime");
    await pool.exec(target("a"), "docker info");
    expect(connect).toHaveBeenCalledTimes(1);
    expect(client.exec).toHaveBeenCalledTimes(2);
    expect(pool.size()).toBe(1);
  });

  it("keys connections by user@host:port", async () => {
    const connect = vi.fn(async () => fakeClient());
    const pool = createSshPool(connect);
    await pool.exec(target("a"), "uptime");
    await pool.exec(target("b"), "uptime");
    await pool.exec({ ...target("a"), port: 2222 }, "uptime");
    expect(connect).toHaveBeenCalledTimes(3);
    expect(pool.size()).toBe(3);
  });

  it("evicts a failed connect so the next exec retries", async () => {
    const good = fakeClient();
    const connect = vi.fn().mockRejectedValueOnce(new Error("refused")).mockResolvedValueOnce(good);
    const pool = createSshPool(connect);
    await expect(pool.exec(target("a"), "uptime")).rejects.toThrow("refused");
    const res = await pool.exec(target("a"), "uptime");
    expect(res.code).toBe(0);
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it("evicts and ends a connection whose exec throws (dead channel)", async () => {
    const bad = fakeClient({
      exec: vi.fn(async () => {
        throw new Error("channel dead");
      }),
    });
    const good = fakeClient();
    const connect = vi.fn().mockResolvedValueOnce(bad).mockResolvedValueOnce(good);
    const pool = createSshPool(connect);
    await expect(pool.exec(target("a"), "uptime")).rejects.toThrow("channel dead");
    expect(bad.end).toHaveBeenCalled();
    await pool.exec(target("a"), "uptime");
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it("drops a connection the transport reports closed", async () => {
    const first = fakeClient();
    const connect = vi.fn(async () => first);
    const pool = createSshPool(connect);
    await pool.exec(target("a"), "uptime");
    first.closed(); // remote hangup
    expect(pool.size()).toBe(0);
    await pool.exec(target("a"), "uptime");
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it("evict() drops + ends one target's connection so the next exec reconnects", async () => {
    const first = fakeClient();
    const second = fakeClient();
    const connect = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const pool = createSshPool(connect);
    await pool.exec(target("a"), "uptime");
    pool.evict(target("a"));
    expect(pool.size()).toBe(0); // dropped synchronously
    await new Promise((r) => setTimeout(r, 0)); // end() runs on the resolved-entry microtask
    expect(first.end).toHaveBeenCalled();
    await pool.exec(target("a"), "uptime"); // fresh login session (post-usermod)
    expect(connect).toHaveBeenCalledTimes(2);
    pool.evict(target("nonexistent")); // no-op, doesn't throw
  });

  it("close() ends every pooled connection", async () => {
    const a = fakeClient();
    const b = fakeClient();
    const connect = vi.fn().mockResolvedValueOnce(a).mockResolvedValueOnce(b);
    const pool = createSshPool(connect);
    await pool.exec(target("a"), "uptime");
    await pool.exec(target("b"), "uptime");
    await pool.close();
    expect(a.end).toHaveBeenCalled();
    expect(b.end).toHaveBeenCalled();
    expect(pool.size()).toBe(0);
  });
});
