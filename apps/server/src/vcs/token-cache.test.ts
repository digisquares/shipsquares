import { describe, expect, it } from "vitest";

import { createTokenCache } from "./token-cache.js";

const HOUR = 3_600_000;

describe("createTokenCache", () => {
  it("returns a cached token that is still well within its TTL", () => {
    const cache = createTokenCache();
    cache.set("inst_1", { token: "t1", expiresAt: 1000 + HOUR });
    expect(cache.get("inst_1", 1000)).toBe("t1");
  });

  it("treats a token within the safety margin of expiry as stale (re-mint)", () => {
    const cache = createTokenCache(); // 5-min default margin
    cache.set("inst_1", { token: "t1", expiresAt: 1000 + HOUR });
    // 4 minutes before expiry → inside the margin → undefined
    expect(cache.get("inst_1", 1000 + HOUR - 4 * 60_000)).toBeUndefined();
  });

  it("misses for an unknown installation", () => {
    const cache = createTokenCache();
    expect(cache.get("nope", 0)).toBeUndefined();
  });

  it("delete busts the entry", () => {
    const cache = createTokenCache();
    cache.set("inst_1", { token: "t1", expiresAt: 1000 + HOUR });
    cache.delete("inst_1");
    expect(cache.get("inst_1", 1000)).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it("honors a custom margin", () => {
    const cache = createTokenCache(60_000); // 1-min margin
    cache.set("inst_1", { token: "t1", expiresAt: 1000 + HOUR });
    // 4 min before expiry is now fresh under a 1-min margin
    expect(cache.get("inst_1", 1000 + HOUR - 4 * 60_000)).toBe("t1");
  });
});
