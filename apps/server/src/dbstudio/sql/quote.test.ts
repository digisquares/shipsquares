import { describe, expect, it } from "vitest";

import { quoteIdent, quoteQualified } from "./quote.js";

describe("quoteIdent", () => {
  it("double-quotes for postgres and escapes embedded quotes", () => {
    expect(quoteIdent("postgres", "users")).toBe('"users"');
    expect(quoteIdent("postgres", 'we"ird')).toBe('"we""ird"');
  });

  it("backtick-quotes for mysql and escapes embedded backticks", () => {
    expect(quoteIdent("mysql", "users")).toBe("`users`");
    expect(quoteIdent("mysql", "we`ird")).toBe("`we``ird`");
  });

  it("neutralizes an injection attempt by quoting, not stripping", () => {
    // The classic break-out attempt stays inside the quotes — it can't escape.
    expect(quoteIdent("postgres", 'a"; DROP TABLE x; --')).toBe('"a""; DROP TABLE x; --"');
    expect(quoteIdent("mysql", "a`; DROP TABLE x; --")).toBe("`a``; DROP TABLE x; --`");
  });

  it("rejects empty and NUL-bearing identifiers", () => {
    expect(() => quoteIdent("postgres", "")).toThrow();
    expect(() => quoteIdent("postgres", "a\0b")).toThrow(/NUL/);
  });
});

describe("quoteQualified", () => {
  it("joins quoted parts with a dot per engine", () => {
    expect(quoteQualified("postgres", ["public", "users"])).toBe('"public"."users"');
    expect(quoteQualified("mysql", ["app", "orders"])).toBe("`app`.`orders`");
  });
});
