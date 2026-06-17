import { describe, expect, it } from "vitest";

import { cookieHeaderFrom } from "./cookie.js";

describe("cookieHeaderFrom", () => {
  it("reduces Set-Cookie headers to a Cookie request header", () => {
    const header = cookieHeaderFrom([
      "ss_session=abc123; Path=/; HttpOnly; SameSite=Lax",
      "csrf=zzz; Path=/",
    ]);
    expect(header).toBe("ss_session=abc123; csrf=zzz");
  });

  it("ignores malformed entries and yields empty for none", () => {
    expect(cookieHeaderFrom(["garbage", ""])).toBe("");
    expect(cookieHeaderFrom([])).toBe("");
  });
});
