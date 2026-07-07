import { NotFoundError } from "@ss/shared";
import { eq } from "drizzle-orm";

import type { Db } from "../db/index.js";
import { organizations } from "../db/schema/index.js";

// Read/rename the caller's own organization (C6). Org *provisioning* (create),
// *deletion* (cascades the whole tenant), and cross-tenant *listing* are out of
// scope for v1 — an org is seeded at install and removed by uninstall — so the
// routes only expose these two tenant-scoped operations.

export interface OrgView {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
}

type OrgRow = typeof organizations.$inferSelect;

function toView(r: OrgRow): OrgView {
  return { id: r.id, name: r.name, slug: r.slug, createdAt: r.createdAt.toISOString() };
}

export async function getOrganization(db: Db, orgId: string): Promise<OrgView> {
  const rows = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
  if (!rows[0]) throw new NotFoundError("organization not found");
  return toView(rows[0]);
}

export async function updateOrganization(
  db: Db,
  orgId: string,
  patch: { name?: string },
): Promise<OrgView> {
  if (patch.name === undefined) return getOrganization(db, orgId); // nothing to change
  const rows = await db
    .update(organizations)
    .set({ name: patch.name })
    .where(eq(organizations.id, orgId))
    .returning();
  if (!rows[0]) throw new NotFoundError("organization not found");
  return toView(rows[0]);
}
