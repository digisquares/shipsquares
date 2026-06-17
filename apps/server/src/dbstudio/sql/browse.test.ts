import { describe, expect, it } from "vitest";

import type { ColumnInfo } from "../introspect/types.js";

import { buildBrowseQuery } from "./browse.js";

const cols: ColumnInfo[] = [
  {
    name: "id",
    dataType: "integer",
    uiType: "number",
    nullable: false,
    default: null,
    isPrimaryKey: true,
  },
  {
    name: "email",
    dataType: "text",
    uiType: "string",
    nullable: false,
    default: null,
    isPrimaryKey: false,
  },
];

describe("buildBrowseQuery", () => {
  it("builds a quoted, capped, parameterized SELECT for postgres", () => {
    const q = buildBrowseQuery(
      "postgres",
      { schema: "public", table: "users", limit: 50, offset: 0 },
      cols,
      1000,
    );
    expect(q.sql).toBe('SELECT "id", "email" FROM "public"."users" LIMIT $1');
    expect(q.params).toEqual([51]); // appliedLimit + 1
    expect(q.appliedLimit).toBe(50);
  });

  it("uses ? placeholders and backticks for mysql, with OFFSET", () => {
    const q = buildBrowseQuery(
      "mysql",
      { schema: "app", table: "orders", limit: 25, offset: 25 },
      cols,
      1000,
    );
    expect(q.sql).toBe("SELECT `id`, `email` FROM `app`.`orders` LIMIT ? OFFSET ?");
    expect(q.params).toEqual([26, 25]);
  });

  it("caps the limit at maxRows", () => {
    const q = buildBrowseQuery(
      "postgres",
      { schema: "public", table: "users", limit: 100000, offset: 0 },
      cols,
      1000,
    );
    expect(q.appliedLimit).toBe(1000);
    expect(q.params).toEqual([1001]);
  });

  it("adds a validated ORDER BY", () => {
    const q = buildBrowseQuery(
      "postgres",
      {
        schema: "public",
        table: "users",
        limit: 10,
        offset: 0,
        sort: { column: "email", dir: "desc" },
      },
      cols,
      1000,
    );
    expect(q.sql).toContain('ORDER BY "email" DESC');
  });

  it("binds eq/like filters with a text cast and wraps like in %", () => {
    const q = buildBrowseQuery(
      "postgres",
      {
        schema: "public",
        table: "users",
        limit: 10,
        offset: 0,
        filters: [
          { column: "id", op: "eq", value: "7" },
          { column: "email", op: "like", value: "acme" },
        ],
      },
      cols,
      1000,
    );
    expect(q.sql).toContain('WHERE "id"::text = $1 AND "email"::text ILIKE $2');
    expect(q.params).toEqual(["7", "%acme%", 11]);
  });

  it("supports isnull/notnull with no bound value", () => {
    const q = buildBrowseQuery(
      "postgres",
      {
        schema: "public",
        table: "users",
        limit: 10,
        offset: 0,
        filters: [{ column: "email", op: "isnull" }],
      },
      cols,
      1000,
    );
    expect(q.sql).toContain('WHERE "email" IS NULL');
    expect(q.params).toEqual([11]);
  });

  it("rejects an unknown sort or filter column (no injection surface)", () => {
    expect(() =>
      buildBrowseQuery(
        "postgres",
        {
          schema: "public",
          table: "users",
          limit: 10,
          offset: 0,
          sort: { column: "evil", dir: "asc" },
        },
        cols,
        1000,
      ),
    ).toThrow(/unknown sort column/);
    expect(() =>
      buildBrowseQuery(
        "postgres",
        {
          schema: "public",
          table: "users",
          limit: 10,
          offset: 0,
          filters: [{ column: "x; DROP", op: "eq", value: "1" }],
        },
        cols,
        1000,
      ),
    ).toThrow(/unknown filter column/);
  });
});
