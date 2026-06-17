import { describe, expect, it } from "vitest";

import { buildCreateTable } from "./ddl";
import type { TableDetail } from "./types";

const detail: TableDetail = {
  schema: "public",
  name: "users",
  columns: [
    {
      name: "id",
      dataType: "integer",
      uiType: "number",
      nullable: false,
      default: "nextval('users_id_seq')",
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
    {
      name: "note",
      dataType: "text",
      uiType: "string",
      nullable: true,
      default: null,
      isPrimaryKey: false,
    },
  ],
  primaryKey: ["id"],
  indexes: [],
  foreignKeys: [
    {
      name: "fk_org",
      columns: ["org_id"],
      refSchema: "public",
      refTable: "orgs",
      refColumns: ["id"],
    },
  ],
};

describe("buildCreateTable", () => {
  it("reconstructs a postgres CREATE with NOT NULL, DEFAULT, PK, FK", () => {
    const sql = buildCreateTable("postgres", detail);
    expect(sql).toContain('CREATE TABLE "public"."users"');
    expect(sql).toContain("\"id\" integer NOT NULL DEFAULT nextval('users_id_seq')");
    expect(sql).toContain('"note" text');
    expect(sql).not.toContain('"note" text NOT NULL');
    expect(sql).toContain('PRIMARY KEY ("id")');
    expect(sql).toContain('CONSTRAINT "fk_org" FOREIGN KEY ("org_id") REFERENCES "orgs" ("id")');
  });

  it("uses backticks + an unqualified name for mysql", () => {
    const sql = buildCreateTable("mysql", { ...detail, schema: "demo" });
    expect(sql).toContain("CREATE TABLE `users`");
    expect(sql).toContain("`email` text NOT NULL");
    expect(sql).not.toContain('"');
  });
});
