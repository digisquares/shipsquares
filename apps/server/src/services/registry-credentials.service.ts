import { AppError, NotFoundError, newId } from "@ss/shared";
import type { Env } from "@ss/shared";
import { and, desc, eq } from "drizzle-orm";

import type { Db } from "../db/index.js";
import { registryCredentials } from "../db/schema/index.js";
import { loadMasterKey, open, seal } from "../secrets/crypto.js";
import type { SealedValue } from "../secrets/types.js";

// Private-registry pull credentials (06/11): the password is sealed at rest
// and only ever opened inside the deploy pipeline to compose the stdin-piped
// docker login (docker/registry-auth.ts). Views never expose it.
const KEY_VERSION = 1;

function masterKey(config: Env): Buffer {
  try {
    return loadMasterKey(config.SHIPSQUARES_MASTER_KEY);
  } catch {
    throw new AppError("registry credentials require SHIPSQUARES_MASTER_KEY", {
      status: 400,
      code: "secrets.unconfigured",
    });
  }
}

type Row = typeof registryCredentials.$inferSelect;

export interface RegistryCredentialView {
  id: string;
  registryUrl: string;
  username: string;
  createdAt: string;
}

export function toRegistryCredentialView(r: Row): RegistryCredentialView {
  return {
    id: r.id,
    registryUrl: r.registryUrl,
    username: r.username,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function listRegistryCredentials(
  db: Db,
  orgId: string,
): Promise<RegistryCredentialView[]> {
  const rows = await db
    .select()
    .from(registryCredentials)
    .where(eq(registryCredentials.organizationId, orgId))
    .orderBy(desc(registryCredentials.createdAt));
  return rows.map(toRegistryCredentialView);
}

export async function createRegistryCredential(
  db: Db,
  config: Env,
  orgId: string,
  input: { registryUrl: string; username: string; password: string },
): Promise<RegistryCredentialView> {
  const rows = await db
    .insert(registryCredentials)
    .values({
      id: newId("reg"),
      organizationId: orgId,
      registryUrl: input.registryUrl,
      username: input.username,
      passwordSecretRef: JSON.stringify(seal(input.password, masterKey(config), KEY_VERSION)),
    })
    .returning();
  return toRegistryCredentialView(rows[0]!);
}

export async function deleteRegistryCredential(db: Db, orgId: string, id: string): Promise<void> {
  const rows = await db
    .delete(registryCredentials)
    .where(and(eq(registryCredentials.id, id), eq(registryCredentials.organizationId, orgId)))
    .returning({ id: registryCredentials.id });
  if (!rows[0]) throw new NotFoundError("registry credential not found");
}

/** Pipeline-only: resolve a credential row + plaintext password for login. */
export async function openRegistryCredential(
  db: Db,
  config: Env,
  id: string,
): Promise<{ registryUrl: string; username: string; password: string } | null> {
  const row = (
    await db.select().from(registryCredentials).where(eq(registryCredentials.id, id)).limit(1)
  )[0];
  if (!row) return null;
  return {
    registryUrl: row.registryUrl,
    username: row.username,
    password: open(JSON.parse(row.passwordSecretRef) as SealedValue, masterKey(config)),
  };
}
