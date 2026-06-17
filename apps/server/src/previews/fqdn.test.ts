import { describe, expect, it } from "vitest";

import { previewFqdn, previewLimitReached, previewSuffix } from "./fqdn.js";

describe("preview environment helpers", () => {
  it("builds a deterministic per-PR wildcard host", () => {
    expect(previewFqdn(42, "web", "preview.acme.com")).toBe("pr-42-web.preview.acme.com");
  });

  it("derives an isolation suffix", () => {
    expect(previewSuffix(42)).toBe("-pr-42");
  });

  it("enforces the per-app concurrency limit", () => {
    expect(previewLimitReached(4, 5)).toBe(false);
    expect(previewLimitReached(5, 5)).toBe(true);
    expect(previewLimitReached(99, 0)).toBe(false); // 0 = unlimited
  });
});
