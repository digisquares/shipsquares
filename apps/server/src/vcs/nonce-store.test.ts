import { describe, expect, it } from "vitest";

import { createNonceStore } from "./nonce-store.js";

const NOW = 1_000_000;

describe("createNonceStore", () => {
  it("accepts a nonce once and rejects the replay", () => {
    const store = createNonceStore(60_000);
    expect(store.consume("n1", NOW)).toBe(true);
    expect(store.consume("n1", NOW + 1)).toBe(false);
    expect(store.consume("n2", NOW + 1)).toBe(true);
  });

  it("forgets nonces after the TTL (no unbounded growth)", () => {
    const store = createNonceStore(60_000);
    store.consume("n1", NOW);
    expect(store.consume("n1", NOW + 60_001)).toBe(true); // expired → fresh again
    expect(store.size()).toBe(1); // the expired entry was swept
  });
});
