import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { execQuery, rowsFor, schemaFor, tableDetailFor } from "../../services/dbstudio.service.js";

import { makeMysqlDriver } from "./mysql.js";
import type { ConnectionConfig } from "./types.js";

// LIVE MySQL/MariaDB integration — the "test the MySQL driver for real" suite.
// Excluded from the default `pnpm test` (vitest.config exclude); run with:
//
//     SS_DBTEST_MYSQL_URL=mysql://user:pass@host:3306/dbname pnpm test:db
//
// Skips cleanly without the URL. Proves engine parity with the pglite Postgres
// suite: the same introspectors + browse builder + read-only runner against a
// real MySQL, exercising mysql2, information_schema, and `?`/LIMIT placeholders.

const DB_URL = process.env.SS_DBTEST_MYSQL_URL;
const d = DB_URL ? describe : describe.skip;

function configFromUrl(raw: string): ConnectionConfig {
  const u = new URL(raw);
  return {
    engine: "mysql",
    host: u.hostname,
    port: u.port ? Number(u.port) : 3306,
    database: decodeURIComponent(u.pathname.replace(/^\//, "")),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    tls: false,
    readOnly: false,
    statementTimeoutMs: 15_000,
    maxRows: 1000,
  };
}

d("MySQL live · driver + introspection + browse", () => {
  const cfg = configFromUrl(DB_URL ?? "mysql://root@localhost:3306/test");
  const driver = makeMysqlDriver(cfg);
  const TABLE = "ss_dbstudio_live_demo";

  beforeAll(async () => {
    await driver.query(`DROP TABLE IF EXISTS \`${TABLE}\``);
    await driver.query(
      `CREATE TABLE \`${TABLE}\` (id INT PRIMARY KEY, email VARCHAR(255) NOT NULL, note TEXT)`,
    );
    await driver.query(
      `INSERT INTO \`${TABLE}\` (id, email, note) VALUES (1,'a@b.com','one'),(2,'c@d.com',NULL),(3,'e@f.com','three')`,
    );
  }, 60_000);

  afterAll(async () => {
    await driver.query(`DROP TABLE IF EXISTS \`${TABLE}\``).catch(() => undefined);
    await driver.close();
  });

  it("authenticates: ping returns a server version", async () => {
    expect((await driver.ping()).serverVersion).toBeTruthy();
  });

  it("lists the demo table in the schema tree", async () => {
    const tree = await schemaFor(driver);
    expect(tree.flatMap((s) => s.tables.map((t) => t.name))).toContain(TABLE);
  });

  it("introspects columns, primary key, and uiType", async () => {
    const detail = await tableDetailFor(driver, cfg.database, TABLE);
    expect(detail.primaryKey).toEqual(["id"]);
    expect(detail.columns.find((c) => c.name === "id")?.uiType).toBe("number");
    expect(detail.columns.find((c) => c.name === "email")?.uiType).toBe("string");
  });

  it("browses rows with sort + cap + hasMore", async () => {
    const page = await rowsFor(driver, 1000, {
      schema: cfg.database,
      table: TABLE,
      limit: 2,
      offset: 0,
      sort: { column: "id", dir: "asc" },
    });
    expect(page.rows).toHaveLength(2);
    expect(page.page.hasMore).toBe(true);
    expect(page.primaryKey).toEqual(["id"]);
  });

  it("runs a read query and rejects a write on a read-only connection", async () => {
    const r = await execQuery(
      driver,
      { readOnly: true, canWrite: false, maxRows: 1000 },
      `select * from \`${TABLE}\``,
    );
    expect(r.rows).toHaveLength(3);
    await expect(
      execQuery(
        driver,
        { readOnly: true, canWrite: true, maxRows: 1000 },
        `delete from \`${TABLE}\``,
      ),
    ).rejects.toMatchObject({ code: "dbstudio.read_only" });
  });
});
