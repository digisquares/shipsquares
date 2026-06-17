import { describe, expect, it } from "vitest";

import { evaluateAlert } from "./alerts.js";

const NOW = 1_000_000_000;
const WINDOW = 300_000; // 5m

describe("evaluateAlert", () => {
  it("fires when the window average crosses the threshold", () => {
    expect(
      evaluateAlert({
        values: [85, 92, 95],
        thresholdPct: 90,
        lastFiredAt: null,
        windowMs: WINDOW,
        now: NOW,
      }),
    ).toBe("fire");
  });

  it("stays quiet below the threshold even with spikes", () => {
    expect(
      evaluateAlert({
        values: [95, 10, 12],
        thresholdPct: 90,
        lastFiredAt: null,
        windowMs: WINDOW,
        now: NOW,
      }),
    ).toBe("quiet");
  });

  it("cools down: never re-fires within one window of the last firing", () => {
    expect(
      evaluateAlert({
        values: [99, 99],
        thresholdPct: 90,
        lastFiredAt: NOW - WINDOW / 2,
        windowMs: WINDOW,
        now: NOW,
      }),
    ).toBe("cooldown");
    expect(
      evaluateAlert({
        values: [99, 99],
        thresholdPct: 90,
        lastFiredAt: NOW - WINDOW - 1,
        windowMs: WINDOW,
        now: NOW,
      }),
    ).toBe("fire");
  });

  it("no samples in the window → quiet (a dead collector must not page)", () => {
    expect(
      evaluateAlert({
        values: [],
        thresholdPct: 90,
        lastFiredAt: null,
        windowMs: WINDOW,
        now: NOW,
      }),
    ).toBe("quiet");
  });
});
