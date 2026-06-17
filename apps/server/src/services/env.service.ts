import { AppError, type Env, NotFoundError, newId } from "@ss/shared";
import { and, asc, eq } from "drizzle-orm";

import type { Db } from "../db/index.js";
import { apps, envVars } from "../db/schema/index.js";
import { loadMasterKey, open, seal } from "../secrets/crypto.js";
import { resolveEnv } from "../secrets/resolver.js";
import type { ResolvedEnv, SealedValue } from "../secrets/types.js";

// Per-app env vars (11-secrets-config.md, minimal). Secret values are sealed
// (AES-256-GCM) at rest with the master key and masked on read; clear values are
// stored plaintext. Injected into the container at deploy time (06).
const KEY_VERSION = 1;

export interface EnvVarInput {
  key: string;
  value: string;
  isSecret?: boolean;
}
export interface EnvVarView {
  key: string;
  value: string | null; // null for secrets (masked)
  isSecret: boolean;
}

function masterKey(config: Env): Buffer {
  try {
    return loadMasterKey(config.SHIPSQUARES_MASTER_KEY);
  } catch {
    throw new AppError("secrets are not configured (SHIPSQUARES_MASTER_KEY is unset)", {
      status: 400,
      code: "secrets.unconfigured",
    });
  }
}

async function assertApp(db: Db, orgId: string, appId: string): Promise<void> {
  const rows = await db
    .select({ id: apps.id })
    .from(apps)
    .where(and(eq(apps.id, appId), eq(apps.organizationId, orgId)))
    .limit(1);
  if (!rows[0]) throw new NotFoundError("app not found");
}

/** Replace the app's entire env set (PUT semantics). */
export async function setEnv(
  db: Db,
  config: Env,
  orgId: string,
  appId: string,
  vars: EnvVarInput[],
): Promise<EnvVarView[]> {
  await assertApp(db, orgId, appId);
  const deduped = [...new Map(vars.map((v) => [v.key, v])).values()];

  // Secrets read back masked, so the UI re-submits a secret with an empty value
  // to mean "keep the existing sealed value". Preserve those; seal only changed
  // secrets. A brand-new secret with no value is an error.
  const existing = await db
    .select()
    .from(envVars)
    .where(and(eq(envVars.appId, appId), eq(envVars.organizationId, orgId)));
  const prevByKey = new Map(existing.map((r) => [r.key, r]));
  const sealsNeeded = deduped.some((v) => v.isSecret && v.value !== "");
  const key = sealsNeeded ? masterKey(config) : null;

  const toStore = (v: EnvVarInput): string | null => {
    if (!v.isSecret) return v.value;
    if (v.value !== "") return JSON.stringify(seal(v.value, key!, KEY_VERSION));
    const prev = prevByKey.get(v.key);
    if (prev?.isSecret && prev.value) return prev.value; // unchanged secret
    throw new AppError(`a value is required for new secret "${v.key}"`, {
      status: 400,
      code: "env.secret_required",
    });
  };

  const rows = deduped.map((v) => ({
    id: newId("env"),
    appId,
    organizationId: orgId,
    key: v.key,
    value: toStore(v),
    isSecret: v.isSecret ?? false,
  }));

  await db.transaction(async (tx) => {
    await tx
      .delete(envVars)
      .where(and(eq(envVars.appId, appId), eq(envVars.organizationId, orgId)));
    if (rows.length > 0) await tx.insert(envVars).values(rows);
  });
  return listEnv(db, orgId, appId);
}

export async function listEnv(db: Db, orgId: string, appId: string): Promise<EnvVarView[]> {
  await assertApp(db, orgId, appId);
  const rows = await db
    .select()
    .from(envVars)
    .where(and(eq(envVars.appId, appId), eq(envVars.organizationId, orgId)))
    .orderBy(asc(envVars.key));
  return rows.map((r) => ({
    key: r.key,
    value: r.isSecret ? null : r.value,
    isSecret: r.isSecret,
  }));
}

/** Resolved env for the deploy executor. App-scoped only — the caller already validated org ownership. */
export async function resolveDeployEnv(db: Db, config: Env, appId: string): Promise<ResolvedEnv> {
  const rows = await db.select().from(envVars).where(eq(envVars.appId, appId));
  const clear: Record<string, string> = {};
  const sealed = new Map<string, string>(); // env key -> sealed JSON
  for (const r of rows) {
    if (r.value == null) continue;
    if (r.isSecret) sealed.set(r.key, r.value);
    else clear[r.key] = r.value;
  }
  let key: Buffer | null = null;
  const openByName = (name: string): string => {
    const sealedValue = sealed.get(name);
    if (sealedValue == null) throw new Error(`unknown secret: ${name}`);
    key ??= masterKey(config);
    return open(JSON.parse(sealedValue) as SealedValue, key);
  };
  return resolveEnv({
    clear,
    secretRefs: [...sealed.keys()].map((k) => ({ key: k, ref: k })),
    openSecret: openByName,
  });
}
