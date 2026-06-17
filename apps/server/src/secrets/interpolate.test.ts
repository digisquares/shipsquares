import { describe, expect, it } from "vitest";

import { interpolate, referencedSecrets } from "./interpolate.js";

describe("interpolate", () => {
  it("expands ${secret:NAME} tokens via the resolver", () => {
    const out = interpolate("postgres://app:${secret:DB_PASSWORD}@db/app", (name) =>
      name === "DB_PASSWORD" ? "s3cr3t" : "?",
    );
    expect(out).toBe("postgres://app:s3cr3t@db/app");
  });

  it("expands multiple tokens and leaves token-free strings unchanged", () => {
    expect(interpolate("${secret:A}-${secret:B}", (n) => n.toLowerCase())).toBe("a-b");
    expect(interpolate("plain", () => "x")).toBe("plain");
  });

  it("lists referenced secret names", () => {
    expect(referencedSecrets("x=${secret:A};y=${secret:B}")).toEqual(["A", "B"]);
    expect(referencedSecrets("no tokens")).toEqual([]);
  });
});
