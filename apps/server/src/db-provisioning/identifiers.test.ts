import { describe, expect, it } from "vitest";

import { assertIdentifier, isValidIdentifier, quoteIdentifier } from "./identifiers.js";

describe("SQL identifier safety", () => {
  it("accepts lowercase snake_case identifiers", () => {
    expect(isValidIdentifier("app_db")).toBe(true);
    expect(isValidIdentifier("_x")).toBe(true);
    expect(isValidIdentifier("a")).toBe(true);
  });

  it("rejects injection attempts and invalid shapes", () => {
    for (const bad of [
      'app"; DROP',
      "app db",
      "App",
      "1db",
      "db;",
      "a".repeat(64),
      "",
      "drop-table",
    ]) {
      expect(isValidIdentifier(bad)).toBe(false);
    }
  });

  it("quoteIdentifier wraps valid names and throws on unsafe ones", () => {
    expect(quoteIdentifier("app_db")).toBe('"app_db"');
    expect(() => quoteIdentifier('x"; DROP TABLE users; --')).toThrow(/invalid SQL identifier/);
    expect(() => assertIdentifier("Bad")).toThrow();
  });
});
