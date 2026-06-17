import { describe, expect, it } from "vitest";

import { buildStatement } from "./dml.js";

describe("buildStatement", () => {
  it("builds a parameterized INSERT (postgres)", () => {
    const s = buildStatement("postgres", {
      op: "insert",
      schema: "public",
      table: "users",
      values: { email: "a@b.com", n: 3 },
    });
    expect(s.sql).toBe('INSERT INTO "public"."users" ("email", "n") VALUES ($1, $2)');
    expect(s.params).toEqual(["a@b.com", 3]);
  });

  it("uses ? placeholders + backticks for mysql INSERT", () => {
    const s = buildStatement("mysql", {
      op: "insert",
      schema: "app",
      table: "t",
      values: { x: 1 },
    });
    expect(s.sql).toBe("INSERT INTO `app`.`t` (`x`) VALUES (?)");
    expect(s.params).toEqual([1]);
  });

  it("builds a PK-qualified UPDATE with SET params before WHERE params", () => {
    const s = buildStatement("postgres", {
      op: "update",
      schema: "public",
      table: "users",
      pk: { id: 7 },
      values: { email: "x@y.com" },
    });
    expect(s.sql).toBe('UPDATE "public"."users" SET "email" = $1 WHERE "id" = $2');
    expect(s.params).toEqual(["x@y.com", 7]);
  });

  it("builds a DELETE and supports composite primary keys", () => {
    const s = buildStatement("mysql", {
      op: "delete",
      schema: "app",
      table: "t",
      pk: { a: 1, b: 2 },
    });
    expect(s.sql).toBe("DELETE FROM `app`.`t` WHERE `a` = ? AND `b` = ?");
    expect(s.params).toEqual([1, 2]);
  });

  it("refuses update/delete without a primary key (no accidental mass mutation)", () => {
    expect(() =>
      buildStatement("postgres", { op: "update", schema: "s", table: "t", values: { a: 1 } }),
    ).toThrow(/primary key/);
    expect(() => buildStatement("postgres", { op: "delete", schema: "s", table: "t" })).toThrow(
      /primary key/,
    );
  });

  it("refuses an empty insert or a no-op update", () => {
    expect(() =>
      buildStatement("postgres", { op: "insert", schema: "s", table: "t", values: {} }),
    ).toThrow();
    expect(() =>
      buildStatement("postgres", {
        op: "update",
        schema: "s",
        table: "t",
        pk: { id: 1 },
        values: {},
      }),
    ).toThrow();
  });

  it("quotes identifiers so a crafted column/table name can't break out", () => {
    const s = buildStatement("postgres", {
      op: "delete",
      schema: "public",
      table: 'a"; drop table x; --',
      pk: { id: 1 },
    });
    expect(s.sql).toContain('"a""; drop table x; --"');
    expect(s.params).toEqual([1]);
  });
});
