import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { AppError, type Env, NotFoundError } from "@ss/shared";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Db } from "../db/index.js";
import * as schema from "../db/schema/index.js";
import { databaseServers, databaseUsers, databases, organizations } from "../db/schema/index.js";
import type { DbDriver, QueryExecResult, QueryFn } from "../dbstudio/engines/types.js";
import { resolveConnection } from "../dbstudio/resolve.js";
import { loadMasterKey, open, seal } from "../secrets/crypto.js";
import type { SealedValue } from "../secrets/types.js";

import {
  applyEdits,
  createExternalConnection,
  deleteExternalConnection,
  execQuery,
  listConnections,
  rowsFor,
  schemaFor,
  tableDetailFor,
} from "./dbstudio.service.js";

// Real-Postgres integration via in-process pglite (no Docker). Two halves:
//  (1) connection-profile row-logic against the actual schema (migration 0020):
//      create/list/delete external profiles, managed synthesis, tenant isolation,
//      secret-hiding, and resolveConnection's credential opening.
//  (2) the introspectors + browse builder run against REAL Postgres (pglite) by
//      wrapping pglite's query as a DbDriver — proving the live SQL + the
//      identifier-quoting injection round-trip, not just the pure mappers.

const cfg = { SHIPSQUARES_MASTER_KEY: randomBytes(32).toString("base64") } as unknown as Env;
const key = loadMasterKey(cfg.SHIPSQUARES_MASTER_KEY);
const sealStr = (plain: string): string => JSON.stringify(seal(plain, key, 1));
const openSecret = (ref: string): string => open(JSON.parse(ref) as SealedValue, key);
const deps = {
  openSecret,
  assertHost: () => Promise.resolve(),
  defaults: { statementTimeoutMs: 15_000, maxRows: 1000 },
};

let pg: PGlite;
let db: Db;
let pgDriver: DbDriver;

beforeAll(async () => {
  pg = new PGlite();
  const d = drizzle(pg, { schema });
  await migrate(d, { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });
  db = d as unknown as Db;
  await db.insert(organizations).values([
    { id: "org_a", name: "Org A", slug: "org-a" },
    { id: "org_b", name: "Org B", slug: "org-b" },
  ]);

  // A demo schema the introspectors will read — incl. a table whose name carries
  // a double-quote, to prove identifier quoting survives a round-trip.
  await pg.exec(`
    CREATE TABLE studio_demo (id serial PRIMARY KEY, email text NOT NULL, note text);
    INSERT INTO studio_demo (email, note) VALUES ('a@b.com', 'one'), ('c@d.com', 'two'), ('e@f.com', NULL);
    CREATE TABLE studio_child (id serial PRIMARY KEY, demo_id integer REFERENCES studio_demo(id));
    CREATE TABLE "qu""ote" (id integer PRIMARY KEY);
    INSERT INTO "qu""ote" (id) VALUES (1);
  `);

  const q: QueryFn = async (sql, params = []) => {
    const r = await pg.query<Record<string, unknown>>(sql, params as unknown[]);
    return {
      fields: (r.fields ?? []).map((f) => ({ name: f.name, dataType: String(f.dataTypeID) })),
      rows: r.rows,
      rowCount: r.rows.length || (r.affectedRows ?? 0),
      command: "",
    };
  };
  pgDriver = {
    engine: "postgres",
    query: q,
    transaction: async (statements) => {
      await pg.query("BEGIN");
      try {
        const out: QueryExecResult[] = [];
        for (const s of statements) out.push(await q(s.sql, s.params));
        await pg.query("COMMIT");
        return out;
      } catch (e) {
        await pg.query("ROLLBACK");
        throw e;
      }
    },
    ping: async () => ({ serverVersion: "pglite" }),
    close: async () => undefined,
  };
}, 60_000);

afterAll(async () => {
  await pg?.close();
});

describe("dbstudio.service connection profiles (pglite integration)", () => {
  it("creates an external profile, seals the password, and the view hides it", async () => {
    const view = await createExternalConnection(
      db,
      cfg,
      "org_a",
      {
        name: "prod-pg",
        engine: "postgres",
        host: "203.0.113.10",
        port: 5432,
        database: "shop",
        username: "reader",
        password: "s3cret",
      },
      { resolve: async () => ["203.0.113.10"] },
    );
    expect(view.id.startsWith("ext:")).toBe(true);
    expect(view.source).toBe("external");
    expect(view).not.toHaveProperty("passwordSecretRef");
    expect(view).not.toHaveProperty("password");
  });

  it("rejects an external host that is a private/loopback literal (SSRF guard)", async () => {
    await expect(
      createExternalConnection(
        db,
        cfg,
        "org_a",
        {
          name: "evil",
          engine: "postgres",
          host: "169.254.169.254",
          port: 5432,
          database: "d",
          username: "u",
          password: "p",
        },
        { resolve: async () => ["203.0.113.1"] },
      ),
    ).rejects.toMatchObject({ status: 400, code: "dbstudio.host_blocked" });
  });

  it("lists managed (synthesized) + external connections, never exposing secrets", async () => {
    await db.insert(databaseServers).values({
      id: "dbs_1",
      organizationId: "org_a",
      engine: "postgres",
      host: "10.0.0.9",
      port: 5432,
      adminSecretRef: sealStr("postgres://admin:apw@10.0.0.9:5432/postgres"),
      isDefault: false,
      tls: true,
    });
    await db.insert(databases).values({
      id: "db_1",
      serverId: "dbs_1",
      organizationId: "org_a",
      name: "shopdb",
      ownerRole: "shopdb_app",
      appId: null,
    });

    const list = await listConnections(db, "org_a");
    const managed = list.find((c) => c.id === "managed:db_1");
    expect(managed).toMatchObject({
      source: "managed",
      engine: "postgres",
      host: "10.0.0.9",
      database: "shopdb",
    });
    expect(list.some((c) => c.source === "external")).toBe(true);
    for (const c of list) expect(JSON.stringify(c)).not.toContain("ciphertext");
  });

  it("resolveConnection opens the sealed credential for external + managed", async () => {
    const ext = (await listConnections(db, "org_a")).find((c) => c.source === "external")!;
    const r = await resolveConnection(db, "org_a", ext.id, deps);
    expect(r.config.password).toBe("s3cret");
    expect(r.readOnly).toBe(true);

    await db.insert(databaseUsers).values({
      id: "dbu_1",
      serverId: "dbs_1",
      organizationId: "org_a",
      username: "shopdb_app",
      passwordSecretRef: sealStr("userpw"),
      databaseId: "db_1",
    });
    const m = await resolveConnection(db, "org_a", "managed:db_1", deps);
    expect(m.config).toMatchObject({
      engine: "postgres",
      host: "10.0.0.9",
      database: "shopdb",
      user: "shopdb_app",
      password: "userpw",
    });
  });

  it("re-validates the external host at resolve time (SSRF), trusting managed", async () => {
    const ext = (await listConnections(db, "org_a")).find((c) => c.source === "external")!;
    const blocked = {
      ...deps,
      assertHost: () =>
        Promise.reject(new AppError("blocked", { status: 400, code: "dbstudio.host_blocked" })),
    };
    await expect(resolveConnection(db, "org_a", ext.id, blocked)).rejects.toMatchObject({
      status: 400,
      code: "dbstudio.host_blocked",
    });
    // Managed connections are trusted infra → assertHost is never called.
    const m = await resolveConnection(db, "org_a", "managed:db_1", blocked);
    expect(m.config.host).toBe("10.0.0.9");
  });

  it("enforces tenant isolation + deletes external profiles (evicting the pool)", async () => {
    const ext = (await listConnections(db, "org_a")).find((c) => c.source === "external")!;
    await expect(resolveConnection(db, "org_b", ext.id, deps)).rejects.toBeInstanceOf(
      NotFoundError,
    );

    const evicted: string[] = [];
    const fakePool = {
      acquire: () => pgDriver,
      evict: (id: string) => {
        evicted.push(id);
        return Promise.resolve();
      },
      size: () => 0,
      closeAll: async () => undefined,
    };
    await deleteExternalConnection(db, "org_a", ext.id, fakePool);
    expect(evicted).toContain(ext.id);
    await expect(deleteExternalConnection(db, "org_a", ext.id, fakePool)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("dbstudio introspection + browse against real Postgres (pglite)", () => {
  it("introspects schemas/tables", async () => {
    const tree = await schemaFor(pgDriver);
    const pub = tree.find((s) => s.name === "public");
    expect(pub?.tables.map((t) => t.name)).toEqual(
      expect.arrayContaining(["studio_demo", "studio_child"]),
    );
  });

  it("introspects columns, primary key, and uiType", async () => {
    const detail = await tableDetailFor(pgDriver, "public", "studio_demo");
    expect(detail.primaryKey).toEqual(["id"]);
    expect(detail.columns.find((c) => c.name === "id")).toMatchObject({
      isPrimaryKey: true,
      uiType: "number",
    });
    expect(detail.columns.find((c) => c.name === "email")).toMatchObject({
      uiType: "string",
      nullable: false,
    });
    // index introspection populates the PK index (pg_index)
    expect(detail.indexes.some((i) => i.primary && i.columns.includes("id"))).toBe(true);
  });

  it("introspects foreign keys", async () => {
    const detail = await tableDetailFor(pgDriver, "public", "studio_child");
    expect(detail.foreignKeys[0]).toMatchObject({
      refTable: "studio_demo",
      refColumns: ["id"],
      columns: ["demo_id"],
    });
  });

  it("browses rows with sort + a row cap that reports hasMore", async () => {
    const page = await rowsFor(pgDriver, 1000, {
      schema: "public",
      table: "studio_demo",
      limit: 2,
      offset: 0,
      sort: { column: "id", dir: "asc" },
    });
    expect(page.rows).toHaveLength(2);
    expect(page.page.hasMore).toBe(true); // 3 rows exist, asked for 2
    expect(page.primaryKey).toEqual(["id"]);
  });

  it("applies an eq filter via a bound, text-cast predicate", async () => {
    const page = await rowsFor(pgDriver, 1000, {
      schema: "public",
      table: "studio_demo",
      limit: 50,
      offset: 0,
      filters: [{ column: "email", op: "eq", value: "a@b.com" }],
    });
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0]).toMatchObject({ email: "a@b.com", note: "one" });
  });

  it("survives an identifier-injection round-trip (quoted table name with a quote)", async () => {
    const detail = await tableDetailFor(pgDriver, "public", 'qu"ote');
    expect(detail.primaryKey).toEqual(["id"]);
    const page = await rowsFor(pgDriver, 1000, {
      schema: "public",
      table: 'qu"ote',
      limit: 10,
      offset: 0,
    });
    expect(page.rows).toHaveLength(1);
  });
});

describe("dbstudio SQL runner against real Postgres (pglite)", () => {
  it("runs a read query and returns rows + timing", async () => {
    const r = await execQuery(
      pgDriver,
      { readOnly: true, canWrite: false, maxRows: 1000 },
      "select * from studio_demo order by id",
    );
    expect(r.rows).toHaveLength(3);
    expect(r.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(r.truncated).toBe(false);
  });

  it("rejects a write on a read-only connection (409)", async () => {
    await expect(
      execQuery(
        pgDriver,
        { readOnly: true, canWrite: true, maxRows: 1000 },
        "delete from studio_demo",
      ),
    ).rejects.toMatchObject({ status: 409, code: "dbstudio.read_only" });
  });

  it("caps the result and flags truncation", async () => {
    const r = await execQuery(
      pgDriver,
      { readOnly: true, canWrite: false, maxRows: 1 },
      "select * from studio_demo",
    );
    expect(r.rows).toHaveLength(1);
    expect(r.truncated).toBe(true);
  });

  it("refuses multiple statements (400)", async () => {
    await expect(
      execQuery(pgDriver, { readOnly: true, canWrite: false, maxRows: 1000 }, "select 1; select 2"),
    ).rejects.toMatchObject({ status: 400, code: "dbstudio.multiple_statements" });
  });
});

describe("dbstudio write path against real Postgres (pglite)", () => {
  beforeAll(async () => {
    await pg.exec(
      `CREATE TABLE studio_w (id integer PRIMARY KEY, label text); INSERT INTO studio_w VALUES (1,'one'),(2,'two');`,
    );
  });

  it("write-mode SQL needs canWrite (403) on a writable connection", async () => {
    await expect(
      execQuery(
        pgDriver,
        { readOnly: false, canWrite: false, maxRows: 1000 },
        "update studio_w set label='x' where id=1",
      ),
    ).rejects.toMatchObject({ status: 403 });
    const r = await execQuery(
      pgDriver,
      { readOnly: false, canWrite: true, maxRows: 1000 },
      "update studio_w set label='x' where id=1",
    );
    expect(r.rowCount).toBe(1);
  });

  it("a destructive write (DELETE without WHERE) needs explicit confirm", async () => {
    await expect(
      execQuery(
        pgDriver,
        { readOnly: false, canWrite: true, maxRows: 1000 },
        "delete from studio_w",
      ),
    ).rejects.toMatchObject({ code: "dbstudio.confirm_required" });
    const r = await execQuery(
      pgDriver,
      { readOnly: false, canWrite: true, maxRows: 1000, confirm: true },
      "delete from studio_w",
    );
    expect(r.rowCount).toBeGreaterThanOrEqual(0);
  });

  it("applyEdits runs a PK-qualified insert+update batch atomically", async () => {
    const out = await applyEdits(pgDriver, false, [
      { op: "insert", schema: "public", table: "studio_w", values: { id: 10, label: "ten" } },
      {
        op: "update",
        schema: "public",
        table: "studio_w",
        pk: { id: 10 },
        values: { label: "TEN" },
      },
    ]);
    expect(out.applied).toBe(2);
    const check = await pgDriver.query("select label from studio_w where id=10");
    expect(check.rows[0]).toMatchObject({ label: "TEN" });
  });

  it("applyEdits rolls back the whole batch on error (no partial apply)", async () => {
    await expect(
      applyEdits(pgDriver, false, [
        { op: "insert", schema: "public", table: "studio_w", values: { id: 20, label: "twenty" } },
        { op: "insert", schema: "public", table: "studio_w", values: { id: 20, label: "dup" } },
      ]),
    ).rejects.toBeTruthy();
    const check = await pgDriver.query("select count(*)::int as n from studio_w where id=20");
    expect(check.rows[0]).toMatchObject({ n: 0 });
  });

  it("applyEdits refuses a read-only connection (409) and a PK-less edit", async () => {
    await expect(
      applyEdits(pgDriver, true, [
        { op: "delete", schema: "public", table: "studio_w", pk: { id: 1 } },
      ]),
    ).rejects.toMatchObject({ status: 409, code: "dbstudio.read_only" });
    await expect(
      applyEdits(pgDriver, false, [{ op: "delete", schema: "public", table: "studio_w" }]),
    ).rejects.toThrow(/primary key/);
  });
});
