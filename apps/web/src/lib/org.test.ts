import { describe, expect, it } from "vitest";

import { memberLabel, scopesLabel } from "./org";

describe("memberLabel", () => {
  it("prefers the display name, then email, then the user id", () => {
    expect(memberLabel({ name: "Ada", email: "a@x.io", userId: "usr_1" })).toBe("Ada");
    expect(memberLabel({ name: null, email: "a@x.io", userId: "usr_1" })).toBe("a@x.io");
    expect(memberLabel({ name: null, email: null, userId: "usr_1" })).toBe("usr_1");
  });
});

describe("scopesLabel", () => {
  it("names an unscoped key honestly and joins explicit scopes", () => {
    expect(scopesLabel([])).toBe("full role access");
    expect(scopesLabel(["app:read", "deployment:write"])).toBe("app:read, deployment:write");
  });
});
