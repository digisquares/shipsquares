import { describe, expect, it } from "vitest";

import { createMutex } from "./mutex.js";

const defer = <T>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

describe("createMutex", () => {
  it("serializes concurrent runs in order", async () => {
    const mutex = createMutex();
    const order: string[] = [];
    const gate = defer<void>();
    const first = mutex.run(async () => {
      order.push("first:start");
      await gate.promise;
      order.push("first:end");
    });
    const second = mutex.run(async () => {
      order.push("second");
    });
    gate.resolve();
    await Promise.all([first, second]);
    expect(order).toEqual(["first:start", "first:end", "second"]);
  });

  it("releases the lock when a run throws (next run still executes)", async () => {
    const mutex = createMutex();
    await expect(
      mutex.run(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await mutex.run(async () => "after")).toBe("after");
  });

  it("returns each run's value", async () => {
    const mutex = createMutex();
    const [a, b] = await Promise.all([mutex.run(async () => 1), mutex.run(async () => 2)]);
    expect([a, b]).toEqual([1, 2]);
  });
});
