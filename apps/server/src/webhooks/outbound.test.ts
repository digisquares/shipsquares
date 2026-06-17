import { describe, expect, it } from "vitest";

import { buildOutboundDelivery, matchesEvent, PLATFORM_EVENTS } from "./outbound.js";
import { verifyOutbound } from "./sign.js";

describe("buildOutboundDelivery", () => {
  it("wraps the payload as {event, data} with event + delivery headers", () => {
    const d = buildOutboundDelivery(
      "deploy.succeeded",
      { deployment: { id: "dpl_1" } },
      { deliveryId: "dlv_abc" },
    );
    expect(JSON.parse(d.body)).toEqual({
      event: "deploy.succeeded",
      data: { deployment: { id: "dpl_1" } },
    });
    expect(d.headers["content-type"]).toBe("application/json");
    expect(d.headers["x-shipsquares-event"]).toBe("deploy.succeeded");
    expect(d.headers["x-shipsquares-delivery"]).toBe("dlv_abc");
    expect(d.headers["x-shipsquares-signature"]).toBeUndefined();
  });

  it("signs the exact body when a secret is set — subscribers can verify", () => {
    const d = buildOutboundDelivery(
      "deploy.failed",
      { a: 1 },
      { deliveryId: "dlv_1", secret: "s" },
    );
    const sig = d.headers["x-shipsquares-signature"];
    expect(sig).toMatch(/^sha256=/);
    expect(verifyOutbound(d.body, sig!, "s")).toBe(true);
    expect(verifyOutbound(d.body, sig!, "wrong")).toBe(false);
  });
});

describe("matchesEvent", () => {
  it("matches exact subscriptions and the * wildcard", () => {
    expect(matchesEvent(["deploy.succeeded"], "deploy.succeeded")).toBe(true);
    expect(matchesEvent(["deploy.failed"], "deploy.succeeded")).toBe(false);
    expect(matchesEvent(["*"], "backup.failed")).toBe(true);
    expect(matchesEvent([], "deploy.succeeded")).toBe(false);
  });
});

describe("PLATFORM_EVENTS", () => {
  it("covers the deploy outcomes the executor emits", () => {
    expect(PLATFORM_EVENTS).toContain("deploy.succeeded");
    expect(PLATFORM_EVENTS).toContain("deploy.failed");
  });
});
