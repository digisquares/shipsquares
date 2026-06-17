import { describe, expect, it } from "vitest";

import { reconcileDecision } from "./reconcile.js";

const NOW = 1_000_000_000;
const COOLDOWN = 30 * 60_000;

describe("reconcileDecision", () => {
  it("notifies when a should-be-running app has no running container", () => {
    expect(
      reconcileDecision({
        expectedRunning: true,
        actuallyRunning: false,
        lastNotifiedAt: null,
        cooldownMs: COOLDOWN,
        now: NOW,
      }),
    ).toBe("notify");
  });

  it("stays quiet while healthy, and for apps never deployed", () => {
    expect(
      reconcileDecision({
        expectedRunning: true,
        actuallyRunning: true,
        lastNotifiedAt: null,
        cooldownMs: COOLDOWN,
        now: NOW,
      }),
    ).toBe("quiet");
    expect(
      reconcileDecision({
        expectedRunning: false,
        actuallyRunning: false,
        lastNotifiedAt: null,
        cooldownMs: COOLDOWN,
        now: NOW,
      }),
    ).toBe("quiet");
  });

  it("respects the cooldown so a down app pages once per window", () => {
    expect(
      reconcileDecision({
        expectedRunning: true,
        actuallyRunning: false,
        lastNotifiedAt: NOW - COOLDOWN / 2,
        cooldownMs: COOLDOWN,
        now: NOW,
      }),
    ).toBe("quiet");
    expect(
      reconcileDecision({
        expectedRunning: true,
        actuallyRunning: false,
        lastNotifiedAt: NOW - COOLDOWN - 1,
        cooldownMs: COOLDOWN,
        now: NOW,
      }),
    ).toBe("notify");
  });
});
