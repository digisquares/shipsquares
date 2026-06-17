import { describe, expect, it } from "vitest";

import { slugifyAppName, validateAppName } from "./validate";

describe("validateAppName", () => {
  it("accepts a clean slug", () => {
    expect(validateAppName("my-api")).toBeNull();
    expect(validateAppName("web2")).toBeNull();
  });
  it("requires a non-empty name", () => {
    expect(validateAppName("   ")).toMatch(/required/i);
  });
  it("rejects names over 63 chars", () => {
    expect(validateAppName("a".repeat(64))).toMatch(/63/);
  });
  it("rejects invalid characters", () => {
    expect(validateAppName("My App")).toMatch(/lowercase/i);
    expect(validateAppName("api_v2")).toMatch(/lowercase/i);
  });
  it("rejects leading/trailing hyphens", () => {
    expect(validateAppName("-api")).toMatch(/hyphen/i);
    expect(validateAppName("api-")).toMatch(/hyphen/i);
  });
});

describe("slugifyAppName", () => {
  it("slugifies free text", () => {
    expect(slugifyAppName("My Cool App!")).toBe("my-cool-app");
  });
  it("collapses separators, trims hyphens, lowercases", () => {
    expect(slugifyAppName("  --API__v2--  ")).toBe("api-v2");
  });
  it("caps length at the max", () => {
    expect(slugifyAppName("a".repeat(80)).length).toBeLessThanOrEqual(63);
  });
  it("yields a name that passes validation", () => {
    expect(validateAppName(slugifyAppName("Order Service 2 🚀"))).toBeNull();
  });
});
