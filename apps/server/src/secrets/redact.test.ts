import { describe, expect, it } from "vitest";

import { makeRedactor } from "./redact.js";

describe("makeRedactor", () => {
  it("masks each secret value to ***", () => {
    const redact = makeRedactor(new Set(["s3cr3t"]));
    expect(redact("token=s3cr3t end")).toBe("token=*** end");
  });

  it("masks multiple secrets on one line, longest-first", () => {
    const redact = makeRedactor(new Set(["secret", "secretvalue"]));
    // longest-first ensures the superstring is fully masked, not half-masked
    expect(redact("a secretvalue b secret c")).toBe("a *** b *** c");
  });

  it("ignores values shorter than 4 chars to avoid over-masking", () => {
    const redact = makeRedactor(new Set(["ab", "longsecret"]));
    expect(redact("ab longsecret")).toBe("ab ***");
  });

  it("is the identity when there is nothing maskable", () => {
    const redact = makeRedactor(new Set(["xy"]));
    expect(redact("nothing here")).toBe("nothing here");
  });
});
