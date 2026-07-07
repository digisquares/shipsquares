import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Db } from "../db/index.js";
import * as schema from "../db/schema/index.js";
import { apps, organizations, registryCredentials } from "../db/schema/index.js";

import { updateApp } from "./apps.service.js";

// Real-Postgres integration (pglite): the registry-credential reference on an
// app must belong to the caller's org — a cross-tenant id is refused, mirroring
// the serverId/vcsConnectionId guards (tenant isolation, 05-auth-rbac.md).

let pg: PGlite;
let db: Db;

beforeAll(async () => {
  pg = new PGlite();
  const d = drizzle(pg, { schema });
  await migrate(d, { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });
  db = d as unknown as Db;
  await db.insert(organizations).values([
    { id: "org_a", name: "A", slug: "a" },
    { id: "org_b", name: "B", slug: "b" },
  ]);
  await db.insert(apps).values({ id: "app_a", organizationId: "org_a", name: "web" });
  await db.insert(registryCredentials).values([
    {
      id: "reg_a",
      organizationId: "org_a",
      registryUrl: "registry.a.example",
      username: "u",
      passwordSecretRef: "sec_a",
    },
    {
      id: "reg_b",
      organizationId: "org_b",
      registryUrl: "registry.b.example",
      username: "u",
      passwordSecretRef: "sec_b",
    },
  ]);
}, 60_000);

afterAll(async () => {
  await pg?.close();
});

describe("apps.service registry-credential org scoping (pglite integration)", () => {
  it("accepts a credential owned by the app's org", async () => {
    const updated = await updateApp(db, "org_a", "app_a", { registryCredentialId: "reg_a" });
    expect(updated.registryCredentialId).toBe("reg_a");
  });

  it("refuses another org's credential (no cross-tenant private-registry use)", async () => {
    await expect(
      updateApp(db, "org_a", "app_a", { registryCredentialId: "reg_b" }),
    ).rejects.toThrow(/does not reference a credential in this org/i);
    // the app's stored credential is unchanged after the refusal
    const rows = await db.select().from(apps).where(eq(apps.id, "app_a"));
    expect(rows[0]?.registryCredentialId).toBe("reg_a");
  });

  it("refuses an unknown credential id", async () => {
    await expect(
      updateApp(db, "org_a", "app_a", { registryCredentialId: "reg_missing" }),
    ).rejects.toThrow(/does not reference a credential in this org/i);
  });

  it("allows clearing the credential (null)", async () => {
    const updated = await updateApp(db, "org_a", "app_a", { registryCredentialId: null });
    expect(updated.registryCredentialId).toBeNull();
  });
});
