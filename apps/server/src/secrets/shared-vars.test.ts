import { describe, expect, it } from "vitest";

import { resolveSharedVars, type SharedVarRecord } from "./shared-vars.js";

const vars: SharedVarRecord[] = [
  { scope: "org", key: "REGION", value: "us", isSecret: false },
  { scope: "org", key: "PORT", value: "3000", isSecret: false },
  { scope: "app", scopeId: "app_1", key: "PORT", value: "8080", isSecret: false },
  { scope: "app", scopeId: "app_1", key: "DB", valueSecretRef: "DB_PASSWORD", isSecret: true },
  { scope: "app", scopeId: "app_2", key: "OTHER", value: "nope", isSecret: false },
];

describe("resolveSharedVars", () => {
  it("inherits org vars and lets app override the same key (app > org)", () => {
    const { clear } = resolveSharedVars(vars, "app_1");
    expect(clear.REGION).toBe("us"); // inherited from org
    expect(clear.PORT).toBe("8080"); // app override wins
    expect(clear.OTHER).toBeUndefined(); // belongs to another app
  });

  it("returns secret shared vars as refs for the resolver", () => {
    const { secretRefs } = resolveSharedVars(vars, "app_1");
    expect(secretRefs).toEqual([{ key: "DB", ref: "DB_PASSWORD" }]);
  });

  it("a different app in the org still inherits org vars only", () => {
    const { clear } = resolveSharedVars(vars, "app_2");
    expect(clear.PORT).toBe("3000"); // no app_2 override → org value
    expect(clear.OTHER).toBe("nope");
  });
});
