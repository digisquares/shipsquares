import { test, expect, type DbConnection } from "../fixtures/test";
import { seedSession } from "../utils/actions";

// DATABASE STUDIO scenarios (docs/testing/04). Mocked mode. Route #/studio is
// lazy-loaded. The SSRF guard (STU-6) and read-only refusal (STU-5) are the two
// security-critical paths and are exercised against the mock's real shapes.

const pgConn: DbConnection = {
  id: "conn_pg",
  name: "prod-pg",
  engine: "postgres",
  host: "db.example.com",
  database: "appdb",
  readOnly: false,
  source: "external",
};

test.describe("Database Studio", () => {
  test("STU-1 — adding a connection introspects its schema and browses a table", async ({
    appPage,
    state,
  }) => {
    seedSession(state);
    await appPage.goto("/#/studio");
    await expect(appPage.getByText("Database Studio")).toBeVisible();
    await expect(appPage.getByText("No connections yet — add one above.")).toBeVisible();

    await appPage.getByRole("button", { name: "+ Add" }).click();
    await appPage.getByLabel("Name").fill("prod-pg");
    await appPage.getByLabel("Host").fill("db.example.com");
    await appPage.getByLabel("Database").fill("appdb");
    await appPage.getByLabel("User").fill("readonly");
    await appPage.getByRole("button", { name: "Add connection" }).click();

    // onCreated auto-selects the connection → schema introspects.
    await expect(appPage.getByRole("navigation", { name: "Schema" })).toBeVisible();
    const usersTable = appPage.getByRole("button", { name: /users/ });
    await expect(usersTable).toBeVisible();
    await usersTable.click();

    // The virtualized grid loads rows for the table.
    await expect(appPage.getByText("olivia@local.test")).toBeVisible();
  });

  test("STU-4 — the SQL editor runs a SELECT and shows results", async ({ appPage, state }) => {
    seedSession(state);
    state.dbConnections = [pgConn];
    await appPage.goto("/#/studio");
    await appPage.getByRole("button", { name: /prod-pg/ }).click();
    await appPage.getByRole("tab", { name: "SQL" }).click();
    await appPage.getByRole("button", { name: "Run", exact: true }).click();

    await expect(appPage.getByText(/1 row · \d+ ms/)).toBeVisible();
  });

  test("STU-5 — a write on a read-only connection is refused with a clear message", async ({
    appPage,
    state,
  }) => {
    seedSession(state);
    state.dbConnections = [{ ...pgConn, id: "conn_ro", name: "replica-ro", readOnly: true }];
    state.fail = {
      "POST /db-connections/conn_ro/query": {
        status: 409,
        body: { detail: "this connection is read-only", code: "dbstudio.read_only" },
      },
    };
    await appPage.goto("/#/studio");
    await appPage.getByRole("button", { name: /replica-ro/ }).click();
    await appPage.getByRole("tab", { name: "SQL" }).click();
    await appPage.getByRole("button", { name: "Run", exact: true }).click();

    await expect(appPage.getByRole("alert")).toContainText("this connection is read-only");
  });

  test("STU-6 — connecting to a loopback host is blocked by the SSRF guard", async ({
    appPage,
    state,
  }) => {
    seedSession(state);
    await appPage.goto("/#/studio");
    await appPage.getByRole("button", { name: "+ Add" }).click();
    await appPage.getByLabel("Name").fill("local-pg");
    await appPage.getByLabel("Host").fill("127.0.0.1");
    await appPage.getByLabel("Database").fill("appdb");
    await appPage.getByLabel("User").fill("postgres");
    await appPage.getByRole("button", { name: "Add connection" }).click();

    await expect(appPage.getByText("loopback address blocked")).toBeVisible();
    // The connection was not added (no rail entry; the form is still open).
    await expect(appPage.getByRole("button", { name: /local-pg/ })).toHaveCount(0);
    await expect(appPage.getByRole("button", { name: "Add connection" })).toBeVisible();
  });
});
