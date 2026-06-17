import { describe, expect, it } from "vitest";

import { ID_PREFIXES, newId } from "./ids.js";

describe("newId", () => {
  it("returns `<prefix>_<21 lowercase-alnum chars>`", () => {
    expect(newId(ID_PREFIXES.app)).toMatch(/^app_[0-9a-z]{21}$/);
    expect(newId(ID_PREFIXES.server)).toMatch(/^srv_[0-9a-z]{21}$/);
    expect(newId(ID_PREFIXES.deployment)).toMatch(/^dpl_[0-9a-z]{21}$/);
  });

  it("every prefix value yields an id with that prefix", () => {
    for (const prefix of Object.values(ID_PREFIXES)) {
      expect(newId(prefix).startsWith(`${prefix}_`)).toBe(true);
    }
  });

  it("produces 10k collision-free ids over the lowercase-alnum alphabet", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const id = newId(ID_PREFIXES.app);
      expect(id.slice(4)).toMatch(/^[0-9a-z]{21}$/);
      seen.add(id);
    }
    expect(seen.size).toBe(10_000);
  });
});
