import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Db } from "../db/index.js";
import * as schema from "../db/schema/index.js";
import { organizations } from "../db/schema/index.js";

import { getOrganization, updateOrganization } from "./organizations.service.js";

// Real-Postgres integration (pglite): the committed migrations create the
// `organizations` table, so read + rename behave as in production (C6).

let pg: PGlite;
let db: Db;

beforeAll(async () => {
  pg = new PGlite();
  const d = drizzle(pg, { schema });
  await migrate(d, { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });
  db = d as unknown as Db;
  await db.insert(organizations).values({ id: "org_a", name: "Acme", slug: "acme" });
}, 60_000);

afterAll(async () => {
  await pg?.close();
});

describe("organizations.service (pglite integration)", () => {
  it("reads an organization", async () => {
    const org = await getOrganization(db, "org_a");
    expect(org).toMatchObject({ id: "org_a", name: "Acme", slug: "acme" });
    expect(typeof org.createdAt).toBe("string");
  });

  it("renames an organization (slug/id unchanged)", async () => {
    const updated = await updateOrganization(db, "org_a", { name: "Acme Corp" });
    expect(updated).toMatchObject({ id: "org_a", name: "Acme Corp", slug: "acme" });
    expect((await getOrganization(db, "org_a")).name).toBe("Acme Corp");
  });

  it("a no-op patch (no name) leaves it unchanged", async () => {
    const same = await updateOrganization(db, "org_a", {});
    expect(same.name).toBe("Acme Corp");
  });

  it("throws NotFoundError for an unknown org", async () => {
    await expect(getOrganization(db, "org_missing")).rejects.toThrow(/not found/i);
    await expect(updateOrganization(db, "org_missing", { name: "x" })).rejects.toThrow(
      /not found/i,
    );
  });
});
