import { createHmac, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { ConflictError, type Env, NotFoundError } from "@ss/shared";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Db } from "../db/index.js";
import * as schema from "../db/schema/index.js";
import { apps, organizations } from "../db/schema/index.js";
import { sealSecretRef } from "../vcs/provider-deps.js";

import {
  createAppRegistration,
  findAppRegistrationByAppId,
  getAppRegistrationById,
  getConnection,
  getOrgAppRegistration,
  listAppRegistrations,
  listConnections,
  upsertGithubAppConnection,
} from "./connections.service.js";
import { createDeployment } from "./deployments.service.js";
import { handleAppInbound } from "./webhooks.service.js";

// Real-Postgres integration tests via in-process pglite (no Docker). The
// committed drizzle/ migrations are applied, so the ACTUAL schema + constraints
// run — the partial unique index, FKs, enums — covering the DB paths the unit
// suite can't: upsert idempotency, tenant isolation, registration CRUD, and the
// R2.7.1 key-link round-trip.

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

describe("connections.service (pglite integration)", () => {
  it("upsertGithubAppConnection is idempotent on (org, installation)", async () => {
    const first = await upsertGithubAppConnection(db, "org_a", {
      provider: "github",
      accountLogin: "acme",
      installationId: "100",
      githubAppId: "1",
      tokenSecretRef: "ref1",
    });
    const second = await upsertGithubAppConnection(db, "org_a", {
      provider: "github",
      accountLogin: "acme-renamed",
      installationId: "100",
      githubAppId: "1",
      tokenSecretRef: "ref2",
    });
    // Same (org, installation) → the row is UPDATED in place, never duplicated
    // (the partial unique index backstops this).
    expect(second.id).toBe(first.id);
    expect(second.accountLogin).toBe("acme-renamed");
    const onInstall100 = (await listConnections(db, "org_a")).filter(
      (c) => c.installationId === "100",
    );
    expect(onInstall100).toHaveLength(1);
  });

  it("getConnection enforces tenant isolation (cross-org = NotFound)", async () => {
    const conn = await upsertGithubAppConnection(db, "org_a", {
      provider: "github",
      accountLogin: "x",
      installationId: "200",
      githubAppId: "1",
      tokenSecretRef: "r",
    });
    await expect(getConnection(db, "org_b", conn.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await getConnection(db, "org_a", conn.id)).id).toBe(conn.id);
  });

  it("app-registration CRUD + lookups by org / appId / id, view hides secrets", async () => {
    const reg = await createAppRegistration(db, "org_a", {
      appId: "555",
      slug: "ss-acme",
      name: "SS acme",
      htmlUrl: "https://github.com/apps/ss-acme",
      credentialsSecretRef: "sealed-creds",
    });
    expect(reg.appId).toBe("555");
    expect(reg).not.toHaveProperty("credentialsSecretRef");
    expect((await getOrgAppRegistration(db, "org_a"))?.id).toBe(reg.id);
    expect((await findAppRegistrationByAppId(db, "555"))?.id).toBe(reg.id);
    expect((await getAppRegistrationById(db, reg.id))?.organizationId).toBe("org_a");
    const list = await listAppRegistrations(db, "org_a");
    expect(list.some((r) => r.id === reg.id)).toBe(true);
  });

  it("links a connection to a registration's shared key (tokenSecretRef null) — R2.7.1", async () => {
    const reg = await createAppRegistration(db, "org_b", {
      appId: "777",
      slug: "ss-b",
      name: "SS b",
      htmlUrl: null,
      credentialsSecretRef: "sealed-b",
    });
    const conn = await upsertGithubAppConnection(db, "org_b", {
      provider: "github",
      accountLogin: "bcorp",
      installationId: "300",
      githubAppId: "777",
      tokenSecretRef: null,
      appRegistrationId: reg.id,
    });
    const full = await getConnection(db, "org_b", conn.id);
    expect(full.appRegistrationId).toBe(reg.id);
    expect(full.tokenSecretRef).toBeNull();
  });
});

// App-level webhook (R2.7) guards + lifecycle, against the real schema. Uses a
// real sealed webhook secret + real HMAC signature; covers the security guards
// and the installation.deleted DB cleanup (paths that short-circuit before any
// deploy, so no docker/git is touched).
describe("handleAppInbound (pglite integration)", () => {
  const cfg = { SHIPSQUARES_MASTER_KEY: randomBytes(32).toString("base64") } as unknown as Env;
  const whSecret = "whsec_integration";
  const sign = (body: Buffer) =>
    `sha256=${createHmac("sha256", whSecret).update(body).digest("hex")}`;

  beforeAll(async () => {
    const credentialsSecretRef = sealSecretRef(
      JSON.stringify({ privateKey: "pk", clientId: "", clientSecret: "", webhookSecret: whSecret }),
      cfg,
    );
    await createAppRegistration(db, "org_a", {
      appId: "999",
      slug: "ss-hook",
      name: "SS hook",
      htmlUrl: null,
      credentialsSecretRef,
    });
  });

  it("404s an unknown app target before touching signatures", async () => {
    const res = await handleAppInbound(
      db,
      cfg,
      { "x-github-hook-installation-target-id": "0" },
      Buffer.from("{}"),
    );
    expect(res.status).toBe(404);
  });

  it("rejects a bad signature with 401", async () => {
    const body = Buffer.from(JSON.stringify({ action: "deleted", installation: { id: 1 } }));
    const res = await handleAppInbound(
      db,
      cfg,
      {
        "x-github-hook-installation-target-id": "999",
        "x-hub-signature-256": "sha256=deadbeef",
        "x-github-event": "installation",
      },
      body,
    );
    expect(res.status).toBe(401);
  });

  it("acks a ping with a valid signature", async () => {
    const body = Buffer.from(JSON.stringify({ zen: "hi" }));
    const res = await handleAppInbound(
      db,
      cfg,
      {
        "x-github-hook-installation-target-id": "999",
        "x-hub-signature-256": sign(body),
        "x-github-event": "ping",
      },
      body,
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ping: true });
  });

  it("installation.deleted prunes the connection (no orphan rows)", async () => {
    await upsertGithubAppConnection(db, "org_a", {
      provider: "github",
      accountLogin: "acme",
      installationId: "999100",
      githubAppId: "999",
      tokenSecretRef: "r",
    });
    expect((await listConnections(db, "org_a")).some((c) => c.installationId === "999100")).toBe(
      true,
    );

    const body = Buffer.from(JSON.stringify({ action: "deleted", installation: { id: 999100 } }));
    const res = await handleAppInbound(
      db,
      cfg,
      {
        "x-github-hook-installation-target-id": "999",
        "x-hub-signature-256": sign(body),
        "x-github-event": "installation",
      },
      body,
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ uninstalled: true });
    expect((await listConnections(db, "org_a")).some((c) => c.installationId === "999100")).toBe(
      false,
    );
  });
});

// Deploy serialization (06): the `deployments_one_active_per_app` guard prevents
// two concurrent deploys clobbering each other — a real production failure mode.
// createDeployment is DB-only (executeDeploy does the docker work separately),
// so it's exercised end-to-end against the real schema.
describe("createDeployment serialization (pglite integration)", () => {
  beforeAll(async () => {
    await db.insert(apps).values([
      { id: "app_1", organizationId: "org_a", name: "app-one" },
      { id: "app_2", organizationId: "org_a", name: "app-two" },
    ]);
  });

  it("queues a deployment, then refuses a second while one is active", async () => {
    const d1 = await createDeployment(db, "org_a", "app_1", { trigger: "manual" });
    expect(d1.status).toBe("queued");
    await expect(
      createDeployment(db, "org_a", "app_1", { trigger: "manual" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("serializes per-app — a different app deploys independently", async () => {
    expect((await createDeployment(db, "org_a", "app_2", { trigger: "manual" })).status).toBe(
      "queued",
    );
  });

  it("404s a deploy for an app in another org (tenant isolation)", async () => {
    await expect(
      createDeployment(db, "org_b", "app_1", { trigger: "manual" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
