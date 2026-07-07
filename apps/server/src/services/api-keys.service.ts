import { NotFoundError, ValidationError, newId } from "@ss/shared";
import { and, desc, eq, isNull } from "drizzle-orm";

import { generateApiKey } from "../auth/api-key-core.js";
import type { Db } from "../db/index.js";
import { apiKeys } from "../db/schema/index.js";
import { PERMISSIONS, type Permission } from "../rbac/permissions.js";

// API keys (05-auth-rbac.md): org-scoped bearer credentials for CLI/MCP/CI.
// The token is returned exactly once; only its hash persists. Keys act as a
// member — scopes (validated against the permission catalog) narrow further.
// Lifecycle (S3): keys can carry an expiry and are revoked softly (revokedAt)
// so the audit trail survives; DELETE remains for permanent cleanup.

type Row = typeof apiKeys.$inferSelect;

export interface ApiKeyView {
  id: string;
  name: string;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export function toApiKeyView(r: Row): ApiKeyView {
  return {
    id: r.id,
    name: r.name,
    scopes: r.scopes,
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
    expiresAt: r.expiresAt?.toISOString() ?? null,
    revokedAt: r.revokedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function listApiKeys(db: Db, orgId: string): Promise<ApiKeyView[]> {
  const rows = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.organizationId, orgId))
    .orderBy(desc(apiKeys.createdAt));
  return rows.map(toApiKeyView);
}

export async function createApiKey(
  db: Db,
  orgId: string,
  createdBy: string | undefined,
  input: { name: string; scopes?: string[]; expiresAt?: string },
): Promise<{ key: ApiKeyView; token: string }> {
  const scopes = input.scopes ?? [];
  const invalid = scopes.filter((s) => !(PERMISSIONS as readonly string[]).includes(s));
  if (invalid.length > 0) {
    throw new ValidationError(`unknown scopes: ${invalid.join(", ")}`);
  }
  let expiresAt: Date | null = null;
  if (input.expiresAt != null) {
    expiresAt = new Date(input.expiresAt);
    if (Number.isNaN(expiresAt.getTime())) {
      throw new ValidationError("expiresAt must be a valid date-time");
    }
    if (expiresAt.getTime() <= Date.now()) {
      throw new ValidationError("expiresAt must be in the future");
    }
  }
  const { token, hash } = generateApiKey();
  const rows = await db
    .insert(apiKeys)
    .values({
      id: newId("key"),
      organizationId: orgId,
      keyHash: hash,
      name: input.name,
      scopes: scopes as Permission[],
      createdBy: createdBy ?? null,
      expiresAt,
    })
    .returning();
  return { key: toApiKeyView(rows[0]!), token };
}

/** Soft-revoke: sets revokedAt once; revoking an already-revoked key is a
 *  no-op that returns the original revocation (idempotent for retries). */
export async function revokeApiKey(db: Db, orgId: string, id: string): Promise<ApiKeyView> {
  const rows = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, id), eq(apiKeys.organizationId, orgId), isNull(apiKeys.revokedAt)))
    .returning();
  if (rows[0]) return toApiKeyView(rows[0]);
  const existing = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.id, id), eq(apiKeys.organizationId, orgId)))
    .limit(1);
  if (!existing[0]) throw new NotFoundError("api key not found");
  return toApiKeyView(existing[0]);
}

export async function deleteApiKey(db: Db, orgId: string, id: string): Promise<void> {
  const rows = await db
    .delete(apiKeys)
    .where(and(eq(apiKeys.id, id), eq(apiKeys.organizationId, orgId)))
    .returning({ id: apiKeys.id });
  if (!rows[0]) throw new NotFoundError("api key not found");
}
