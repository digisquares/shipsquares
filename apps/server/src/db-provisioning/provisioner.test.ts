import { describe, expect, it, vi } from "vitest";

import { dropStatements, provisionDatabase, provisionStatements } from "./provisioner.js";

describe("provisionStatements", () => {
  it("creates role → database (owned) → locks down public access, in order", () => {
    const stmts = provisionStatements({ database: "shop", user: "shop_app", password: "p@ss" });
    expect(stmts).toEqual([
      `CREATE ROLE "shop_app" WITH LOGIN PASSWORD 'p@ss'`,
      `CREATE DATABASE "shop" OWNER "shop_app"`,
      `REVOKE ALL ON DATABASE "shop" FROM PUBLIC`,
    ]);
  });

  it("escapes quotes in the password literal (never breaks out)", () => {
    const stmts = provisionStatements({ database: "shop", user: "u", password: "p'; DROP--" });
    expect(stmts[0]).toBe(`CREATE ROLE "u" WITH LOGIN PASSWORD 'p''; DROP--'`);
  });

  it("rejects unsafe identifiers outright", () => {
    expect(() =>
      provisionStatements({ database: 'shop"; DROP', user: "u", password: "p" }),
    ).toThrow(/identifier/);
    expect(() => provisionStatements({ database: "shop", user: "U-bad", password: "p" })).toThrow(
      /identifier/,
    );
  });
});

describe("dropStatements", () => {
  it("drops the database then the role, if they exist", () => {
    expect(dropStatements({ database: "shop", user: "shop_app" })).toEqual([
      `DROP DATABASE IF EXISTS "shop"`,
      `DROP ROLE IF EXISTS "shop_app"`,
    ]);
  });
});

describe("provisionDatabase", () => {
  it("executes every statement in order through the injected admin executor", async () => {
    const ran: string[] = [];
    const exec = vi.fn(async (sql: string) => {
      ran.push(sql);
    });
    const r = await provisionDatabase({ database: "shop", user: "u", password: "p" }, exec);
    expect(r.ok).toBe(true);
    expect(ran).toHaveLength(3);
    expect(ran[1]).toContain('CREATE DATABASE "shop"');
  });

  it("stops at the first failure and reports which statement failed", async () => {
    const exec = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("permission denied"));
    const r = await provisionDatabase({ database: "shop", user: "u", password: "p" }, exec);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("permission denied");
    expect(r.error).toContain("CREATE DATABASE");
    expect(exec).toHaveBeenCalledTimes(2); // never reaches the REVOKE
  });
});
