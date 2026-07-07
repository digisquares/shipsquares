import { afterEach, describe, expect, it, vi } from "vitest";

import { runShutdown } from "./shutdown.js";

afterEach(() => {
  vi.useRealTimers();
});

function harness(overrides: Partial<Parameters<typeof runShutdown>[0]> = {}) {
  const calls: string[] = [];
  const exit = vi.fn((_code: number) => {});
  const deps = {
    app: { close: vi.fn(async () => void calls.push("app.close")) },
    stops: [async () => void calls.push("stopA"), async () => void calls.push("stopB")],
    exit,
    log: () => {},
    errorLog: () => {},
    ...overrides,
  };
  return { calls, exit, deps };
}

describe("runShutdown", () => {
  it("stops background loops before app.close, then exits 0", async () => {
    const { calls, exit, deps } = harness();
    await runShutdown(deps);
    expect(calls).toEqual(["stopA", "stopB", "app.close"]);
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  it("a throwing background stop does not block the drain", async () => {
    const { calls, exit, deps } = harness({
      stops: [
        async () => {
          throw new Error("collector boom");
        },
        async () => void calls.push("stopB"),
      ],
    });
    await runShutdown(deps);
    expect(calls).toEqual(["stopB", "app.close"]);
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  it("exits 1 when app.close rejects", async () => {
    const { exit, deps } = harness({
      app: { close: vi.fn(async () => Promise.reject(new Error("drain failed"))) },
    });
    await runShutdown(deps);
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("forces exit 1 when the drain hangs past the watchdog", async () => {
    vi.useFakeTimers();
    const exit = vi.fn((_code: number) => {});
    // app.close never resolves — the watchdog must fire.
    const p = runShutdown({
      app: { close: () => new Promise<void>(() => {}) },
      exit,
      timeoutMs: 25_000,
      log: () => {},
      errorLog: () => {},
    });
    await vi.advanceTimersByTimeAsync(25_000);
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    void p;
  });
});
