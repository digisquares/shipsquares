import { ConflictError, NotFoundError, newId } from "@ss/shared";
import { and, asc, eq } from "drizzle-orm";

import type { Db } from "../db/index.js";
import { apps, domains } from "../db/schema/index.js";

import { isUniqueViolation } from "./util.js";

export interface DomainView {
  id: string;
  appId: string;
  fqdn: string;
  https: boolean;
  certStatus: "pending" | "issuing" | "active" | "failed" | "disabled";
  isPrimary: boolean;
  createdAt: string;
}

type DomainRow = typeof domains.$inferSelect;

function toView(r: DomainRow): DomainView {
  return {
    id: r.id,
    appId: r.appId,
    fqdn: r.fqdn,
    https: r.https,
    certStatus: r.certStatus,
    isPrimary: r.isPrimary,
    createdAt: r.createdAt.toISOString(),
  };
}

async function assertApp(db: Db, orgId: string, appId: string): Promise<void> {
  const rows = await db
    .select({ id: apps.id })
    .from(apps)
    .where(and(eq(apps.id, appId), eq(apps.organizationId, orgId)))
    .limit(1);
  if (!rows[0]) throw new NotFoundError("app not found");
}

export async function addDomain(
  db: Db,
  orgId: string,
  appId: string,
  input: { fqdn: string; https?: boolean },
): Promise<DomainView> {
  await assertApp(db, orgId, appId);
  try {
    const rows = await db
      .insert(domains)
      .values({
        id: newId("dom"),
        appId,
        organizationId: orgId,
        fqdn: input.fqdn,
        ...(input.https !== undefined ? { https: input.https } : {}),
      })
      .returning();
    return toView(rows[0]!);
  } catch (err) {
    if (isUniqueViolation(err)) throw new ConflictError(`domain "${input.fqdn}" is already in use`);
    throw err;
  }
}

export async function listDomains(db: Db, orgId: string, appId: string): Promise<DomainView[]> {
  await assertApp(db, orgId, appId);
  const rows = await db
    .select()
    .from(domains)
    .where(and(eq(domains.appId, appId), eq(domains.organizationId, orgId)))
    .orderBy(asc(domains.createdAt));
  return rows.map(toView);
}

export async function removeDomain(db: Db, orgId: string, id: string): Promise<void> {
  const rows = await db
    .delete(domains)
    .where(and(eq(domains.id, id), eq(domains.organizationId, orgId)))
    .returning({ id: domains.id });
  if (!rows[0]) throw new NotFoundError("domain not found");
}
