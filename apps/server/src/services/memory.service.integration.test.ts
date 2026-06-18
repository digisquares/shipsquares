import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Db } from "../db/index.js";
import * as schema from "../db/schema/index.js";
import { organizations } from "../db/schema/index.js";

import { MEMORY_MAX, forgetMemory, listMemories, rememberMemory } from "./memory.service.js";

// Real-Postgres integration (in-process pglite): the committed migrations run, so
// the (org, key) unique index + upsert + cap behave as in production.

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
}, 60_000);

afterAll(async () => {
  await pg?.close();
});

describe("memory.service (pglite integration)", () => {
  it("remembers and lists a fact", async () => {
    const res = await rememberMemory(db, "org_a", "prod-app", "their prod app is api");
    expect(res.ok).toBe(true);
    const mems = await listMemories(db, "org_a");
    expect(mems).toContainEqual({ key: "prod-app", content: "their prod app is api" });
  });

  it("upserts by (org, key) — same key updates in place, never duplicates", async () => {
    await rememberMemory(db, "org_a", "region", "us-east");
    await rememberMemory(db, "org_a", "region", "eu-west");
    const matching = (await listMemories(db, "org_a")).filter((m) => m.key === "region");
    expect(matching).toEqual([{ key: "region", content: "eu-west" }]);
  });

  it("rejects empty or oversized content", async () => {
    expect((await rememberMemory(db, "org_a", "k", "")).ok).toBe(false);
    expect((await rememberMemory(db, "org_a", "", "v")).ok).toBe(false);
    expect((await rememberMemory(db, "org_a", "big", "x".repeat(501))).ok).toBe(false);
  });

  it("forgets a fact and reports a miss", async () => {
    await rememberMemory(db, "org_a", "temp", "scratch");
    expect((await forgetMemory(db, "org_a", "temp")).ok).toBe(true);
    expect((await listMemories(db, "org_a")).some((m) => m.key === "temp")).toBe(false);
    expect((await forgetMemory(db, "org_a", "temp")).ok).toBe(false); // already gone
  });

  it("keeps orgs isolated", async () => {
    await rememberMemory(db, "org_b", "secret-ish", "org b only");
    expect((await listMemories(db, "org_a")).some((m) => m.key === "secret-ish")).toBe(false);
  });

  it("caps new keys per org but still allows updating existing ones", async () => {
    // org_b starts with 1 memory; fill to the cap, then a new key is rejected.
    for (let i = (await listMemories(db, "org_b")).length; i < MEMORY_MAX; i += 1) {
      const r = await rememberMemory(db, "org_b", `k${i}`, "v");
      expect(r.ok).toBe(true);
    }
    expect((await listMemories(db, "org_b")).length).toBe(MEMORY_MAX);
    expect((await rememberMemory(db, "org_b", "one-too-many", "v")).ok).toBe(false);
    // updating an existing key is still fine at the cap
    expect((await rememberMemory(db, "org_b", "secret-ish", "updated")).ok).toBe(true);
  });
});
