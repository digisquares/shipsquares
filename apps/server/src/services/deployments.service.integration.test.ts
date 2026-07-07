import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Db } from "../db/index.js";
import * as schema from "../db/schema/index.js";
import { apps, deployments, organizations } from "../db/schema/index.js";

import { containerBelongsToOrg } from "./deployments.service.js";

// Real-Postgres integration (in-process pglite): the committed migrations run, so
// the jsonb `meta ->> 'container'` lookup that gates the interactive console
// behaves as in production. This is the cross-tenant guard for `docker exec`.

let pg: PGlite;
let db: Db;

beforeAll(async () => {
  pg = new PGlite();
  const d = drizzle(pg, { schema });
  await migrate(d, { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });
  db = d as unknown as Db;
  await db.insert(organizations).values([
    { id: "org_a", name: "Org A", slug: "org-a" },
    { id: "org_b", name: "Org B", slug: "org-b" },
  ]);
  await db.insert(apps).values([
    { id: "app_a", organizationId: "org_a", name: "app-a" },
    { id: "app_b", organizationId: "org_b", name: "app-b" },
  ]);
  await db.insert(deployments).values([
    {
      id: "dpl_a",
      appId: "app_a",
      organizationId: "org_a",
      trigger: "manual",
      status: "succeeded",
      meta: { container: "ss-app_a-deadbeef" },
    },
    {
      id: "dpl_b",
      appId: "app_b",
      organizationId: "org_b",
      trigger: "manual",
      status: "succeeded",
      meta: { container: "ss-app_b-cafef00d" },
    },
    // a deployment with no container recorded (e.g. failed before run) — must not
    // grant access to anything.
    {
      id: "dpl_nometa",
      appId: "app_a",
      organizationId: "org_a",
      trigger: "manual",
      status: "failed",
    },
  ]);
}, 60_000);

afterAll(async () => {
  await pg?.close();
});

describe("containerBelongsToOrg (pglite integration)", () => {
  it("accepts a container recorded in the org's own deployment", async () => {
    expect(await containerBelongsToOrg(db, "org_a", "ss-app_a-deadbeef")).toBe(true);
  });

  it("refuses another org's container — the cross-tenant exec gap", async () => {
    // org_b's real, running container name; org_a must not be able to console it.
    expect(await containerBelongsToOrg(db, "org_a", "ss-app_b-cafef00d")).toBe(false);
    // and the reverse
    expect(await containerBelongsToOrg(db, "org_b", "ss-app_a-deadbeef")).toBe(false);
  });

  it("refuses an unknown / never-deployed container name", async () => {
    expect(await containerBelongsToOrg(db, "org_a", "postgres")).toBe(false);
    expect(await containerBelongsToOrg(db, "org_a", "ss-app_a-00000000")).toBe(false);
  });

  it("refuses an empty target without hitting the db", async () => {
    expect(await containerBelongsToOrg(db, "org_a", "")).toBe(false);
  });
});
