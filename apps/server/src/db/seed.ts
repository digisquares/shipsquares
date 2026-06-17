import { pathToFileURL } from "node:url";

import { memberships, organizations, servers, users } from "./schema/index.js";

import { client, db } from "./index.js";

// Deterministic, idempotent first-run seed: one org, one owner user + membership,
// and one local control server. Re-running leaves exactly one of each (fixed ids
// + onConflictDoNothing).
const ORG_ID = "org_seedshipsquares000000";
const USER_ID = "usr_seedowner00000000000";
const MEMBERSHIP_ID = "mbr_seedowner00000000000";
const SERVER_ID = "srv_seedcontrol000000000";

export async function seed(): Promise<void> {
  await db
    .insert(organizations)
    .values({ id: ORG_ID, name: "ShipSquares", slug: "shipsquares" })
    .onConflictDoNothing();
  await db
    .insert(users)
    .values({ id: USER_ID, name: "Owner", email: "owner@shipsquares.local", emailVerified: true })
    .onConflictDoNothing();
  await db
    .insert(memberships)
    .values({ id: MEMBERSHIP_ID, organizationId: ORG_ID, userId: USER_ID, role: "owner" })
    .onConflictDoNothing();
  await db
    .insert(servers)
    .values({
      id: SERVER_ID,
      organizationId: ORG_ID,
      name: "control",
      host: "127.0.0.1",
      role: "control",
      dockerOk: true,
      caddyOk: true,
    })
    .onConflictDoNothing();
}

// Run directly via `pnpm db:seed` (tsx src/db/seed.ts).
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  void seed()
    .then(async () => {
      console.log("seed complete");
      await client.end();
      process.exit(0);
    })
    .catch((err: unknown) => {
      console.error(err);
      process.exit(1);
    });
}
