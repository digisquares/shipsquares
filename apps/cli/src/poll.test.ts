import { describe, expect, it, vi } from "vitest";

import { HttpError } from "./api.js";
import { pollDeployment } from "./poll.js";

const noSleep = () => Promise.resolve();

function statusSequence(statuses: (string | Error)[]) {
  let i = 0;
  return vi.fn(async () => {
    const next = statuses[Math.min(i, statuses.length - 1)]!;
    i += 1;
    if (next instanceof Error) throw next;
    return { status: next };
  });
}

describe("pollDeployment", () => {
  it("resolves on terminal statuses", async () => {
    const ok = await pollDeployment({
      getStatus: statusSequence(["queued", "running", "succeeded"]),
      sleep: noSleep,
    });
    expect(ok.outcome).toBe("succeeded");
    const bad = await pollDeployment({
      getStatus: statusSequence(["running", "failed"]),
      sleep: noSleep,
    });
    expect(bad.outcome).toBe("failed");
  });

  it("tolerates transient failures (5xx/network) up to the consecutive cap", async () => {
    const flaky = statusSequence([
      new HttpError(502, "bad gateway"),
      new Error("ECONNRESET"),
      "running",
      new HttpError(500, "boom"),
      "succeeded",
    ]);
    const r = await pollDeployment({ getStatus: flaky, sleep: noSleep, maxConsecutiveFailures: 3 });
    expect(r.outcome).toBe("succeeded");
  });

  it("gives up after too many consecutive failures, carrying the last error", async () => {
    const dead = statusSequence([new Error("down"), new Error("down"), new Error("down")]);
    const r = await pollDeployment({ getStatus: dead, sleep: noSleep, maxConsecutiveFailures: 3 });
    expect(r.outcome).toBe("error");
    expect(r.error).toContain("down");
  });

  it("aborts immediately on 401/404 (auth lost / deployment gone)", async () => {
    const gone = statusSequence([new HttpError(404, "not found"), "succeeded"]);
    const r = await pollDeployment({ getStatus: gone, sleep: noSleep });
    expect(r.outcome).toBe("error");
    expect(r.error).toContain("not found");
    expect(gone).toHaveBeenCalledTimes(1); // no retry on 404
  });

  it("times out on the configured budget", async () => {
    const r = await pollDeployment({
      getStatus: statusSequence(["running"]),
      sleep: noSleep,
      intervalMs: 1000,
      timeoutMs: 3000,
    });
    expect(r.outcome).toBe("timeout");
  });
});
