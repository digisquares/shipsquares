import { describe, expect, it } from "vitest";

import {
  estimatedRows,
  groupForeignKeys,
  groupIndexes,
  groupSchemas,
  toColumnInfos,
  truthy,
} from "./map.js";

describe("groupSchemas", () => {
  it("groups tables under their schema", () => {
    const out = groupSchemas([
      { schema: "public", name: "users", kind: "table", estimatedRows: 10 },
      { schema: "public", name: "v_active", kind: "view", estimatedRows: null },
      { schema: "billing", name: "invoices", kind: "table", estimatedRows: 3 },
    ]);
    expect(out).toHaveLength(2);
    expect(out.find((s) => s.name === "public")?.tables.map((t) => t.name)).toEqual([
      "users",
      "v_active",
    ]);
    expect(out.find((s) => s.name === "billing")?.tables[0]?.kind).toBe("table");
  });
});

describe("toColumnInfos", () => {
  it("applies uiType + marks primary-key columns", () => {
    const cols = toColumnInfos(
      "postgres",
      [
        { name: "id", dataType: "integer", nullable: false, default: "nextval(...)" },
        { name: "email", dataType: "text", nullable: true, default: null },
      ],
      ["id"],
    );
    expect(cols[0]).toMatchObject({
      name: "id",
      uiType: "number",
      isPrimaryKey: true,
      nullable: false,
    });
    expect(cols[1]).toMatchObject({ name: "email", uiType: "string", isPrimaryKey: false });
  });
});

describe("groupForeignKeys", () => {
  it("dedupes the kcu×ccu cartesian into one FK per constraint", () => {
    const fks = groupForeignKeys([
      {
        name: "fk_order_user",
        column: "user_id",
        refSchema: "public",
        refTable: "users",
        refColumn: "id",
      },
      {
        name: "fk_order_user",
        column: "user_id",
        refSchema: "public",
        refTable: "users",
        refColumn: "id",
      },
    ]);
    expect(fks).toHaveLength(1);
    expect(fks[0]).toMatchObject({ columns: ["user_id"], refTable: "users", refColumns: ["id"] });
  });
});

describe("estimatedRows", () => {
  it("rounds non-negative estimates and nulls out -1/NaN", () => {
    expect(estimatedRows(42.7)).toBe(43);
    expect(estimatedRows(-1)).toBeNull();
    expect(estimatedRows("nope")).toBeNull();
  });
});

describe("groupIndexes", () => {
  it("groups ordered per-column rows into one index, carrying unique/primary", () => {
    const out = groupIndexes([
      { name: "users_pkey", column: "id", unique: true, primary: true },
      { name: "ix_name", column: "last", unique: false, primary: false },
      { name: "ix_name", column: "first", unique: false, primary: false },
    ]);
    expect(out).toHaveLength(2);
    expect(out.find((i) => i.name === "users_pkey")).toMatchObject({
      columns: ["id"],
      unique: true,
      primary: true,
    });
    // composite columns accumulate in row order
    expect(out.find((i) => i.name === "ix_name")?.columns).toEqual(["last", "first"]);
  });
});

describe("truthy", () => {
  it("normalizes catalog booleans (true/1/'t'/'true'/'1') and rejects the rest", () => {
    expect([true, 1, "t", "true", "1"].every(truthy)).toBe(true);
    expect([false, 0, "f", "false", null, undefined].some(truthy)).toBe(false);
  });
});
