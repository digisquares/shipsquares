import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { loadConfig, newId } from "@ss/shared";
import { eq } from "drizzle-orm";

import { client, db } from "../db/index.js";
import { memberships, organizations, servers, users } from "../db/schema/index.js";

import { buildAuth } from "./better-auth.js";

// First-admin seed for the installer (18-installer-ops.md / 05-auth-rbac.md):
// creates the owner user WITH a credential (via better-auth, so the password
// hash is correct), the bootstrap org + owner membership, and the local control
// server. Idempotent: re-running with the same email is a no-op.
const ORG_SLUG = "shipsquares";

export async function seedAdmin(opts: {
  email: string;
  password: string;
  name?: string;
}): Promise<{ userId: string; organizationId: string }> {
  const auth = buildAuth(loadConfig());

  // 1. user (better-auth owns the password hash in `accounts`).
  const existingUser = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, opts.email))
    .limit(1);
  let userId = existingUser[0]?.id;
  if (!userId) {
    const res = await auth.api.signUpEmail({
      body: { email: opts.email, password: opts.password, name: opts.name ?? "Owner" },
    });
    userId = res.user.id;
  }

  // 2. bootstrap org.
  const existingOrg = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.slug, ORG_SLUG))
    .limit(1);
  let organizationId = existingOrg[0]?.id;
  if (!organizationId) {
    organizationId = newId("org");
    await db
      .insert(organizations)
      .values({ id: organizationId, name: "ShipSquares", slug: ORG_SLUG })
      .onConflictDoNothing();
    organizationId = (
      await db
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.slug, ORG_SLUG))
        .limit(1)
    )[0]!.id;
  }

  // 3. owner membership (unique org×user).
  await db
    .insert(memberships)
    .values({ id: newId("mbr"), organizationId, userId, role: "owner" })
    .onConflictDoNothing();

  // 4. local control server (one per org).
  const existingServer = await db
    .select({ id: servers.id })
    .from(servers)
    .where(eq(servers.organizationId, organizationId))
    .limit(1);
  if (!existingServer[0]) {
    await db
      .insert(servers)
      .values({
        id: newId("srv"),
        organizationId,
        name: "control",
        host: "127.0.0.1",
        role: "control",
        dockerOk: true,
        caddyOk: true,
      })
      .onConflictDoNothing();
  }

  return { userId, organizationId };
}

// CLI: `node dist/auth/seed-admin.js` with ADMIN_EMAIL / ADMIN_PASSWORD in env.
// realpathSync resolves the /opt/shipsquares/current symlink so the entry check
// matches import.meta.url (the real path) when invoked through the symlink.
const invokedPath = process.argv[1] ? pathToFileURL(realpathSync(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    console.error("ADMIN_EMAIL and ADMIN_PASSWORD are required");
    process.exit(2);
  }
  void seedAdmin({ email, password })
    .then(async (r) => {
      console.log(`admin seeded: user=${r.userId} org=${r.organizationId}`);
      await client.end();
      process.exit(0);
    })
    .catch((err: unknown) => {
      console.error(err);
      process.exit(1);
    });
}
