import { describe, expect, it } from "vitest";

import { ACTIVE_DEPLOYMENT_STATUSES, isUniqueViolation } from "./deployments.service.js";

describe("per-app deploy serialization helpers", () => {
  it("treats exactly queued + running as active", () => {
    expect([...ACTIVE_DEPLOYMENT_STATUSES]).toEqual(["queued", "running"]);
    expect(ACTIVE_DEPLOYMENT_STATUSES).not.toContain("succeeded");
    expect(ACTIVE_DEPLOYMENT_STATUSES).not.toContain("failed");
    expect(ACTIVE_DEPLOYMENT_STATUSES).not.toContain("cancelled");
  });

  it("recognizes a postgres unique violation (SQLSTATE 23505 string code)", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
    expect(isUniqueViolation(Object.assign(new Error("dup"), { code: "23505" }))).toBe(true);
  });

  it("walks the cause chain (drizzle wraps the postgres.js error)", () => {
    const pg = Object.assign(new Error("duplicate key"), { code: "23505" });
    const wrapped = new Error("query failed", { cause: pg });
    expect(isUniqueViolation(wrapped)).toBe(true);
    expect(isUniqueViolation(new Error("query failed", { cause: new Error("other") }))).toBe(false);
  });

  it("rejects everything else", () => {
    expect(isUniqueViolation(new Error("boom"))).toBe(false);
    expect(isUniqueViolation({ code: 23505 })).toBe(false); // numeric — pg uses strings
    expect(isUniqueViolation({ code: "23503" })).toBe(false); // FK violation
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation("23505")).toBe(false);
  });
});
