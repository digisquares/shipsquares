import { AppError, NotFoundError } from "@ss/shared";
import { and, asc, eq } from "drizzle-orm";

import type { Db } from "../db/index.js";
import { memberships, organizations, sessions, users } from "../db/schema/index.js";
import type { Role } from "../lib/ctx.js";
import { memberChangeCheck } from "../rbac/member-guards.js";

// Org member management (04-api-openapi.md / 05-auth-rbac.md): list, change
// role, remove — guarded by the tested invariants (admins manage non-owners,
// the last owner is immovable). Invites need outbound email and are recorded
// as pending work, not stubbed.

export interface MemberView {
  id: string;
  userId: string;
  email: string | null;
  name: string | null;
  role: string;
  createdAt: string;
}

export async function listMembers(db: Db, orgId: string): Promise<MemberView[]> {
  const rows = await db
    .select({
      id: memberships.id,
      userId: memberships.userId,
      role: memberships.role,
      createdAt: memberships.createdAt,
      email: users.email,
      name: users.name,
    })
    .from(memberships)
    .leftJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.organizationId, orgId))
    .orderBy(asc(memberships.createdAt));
  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    email: r.email,
    name: r.name,
    role: r.role,
    createdAt: r.createdAt.toISOString(),
  }));
}

export interface MyOrgView {
  id: string;
  name: string;
  slug: string;
  role: string;
  active: boolean;
}

/** Every org the user belongs to + which one is active for this session
 *  (ROADMAP R3.1 — drives the org switcher). */
export async function listMyOrganizations(
  db: Db,
  userId: string,
  activeOrgId: string | null,
): Promise<MyOrgView[]> {
  const rows = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      role: memberships.role,
      createdAt: memberships.createdAt,
    })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
    .where(eq(memberships.userId, userId))
    .orderBy(asc(memberships.createdAt));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    role: r.role,
    active: r.id === activeOrgId,
  }));
}

/** Switch the active org for THIS session (R3.1). Verifies membership, then
 *  writes the better-auth session column the resolver already reads. */
export async function setActiveOrg(
  db: Db,
  userId: string,
  sessionId: string,
  orgId: string,
): Promise<void> {
  const member = (
    await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.organizationId, orgId)))
      .limit(1)
  )[0];
  if (!member) throw new NotFoundError("you are not a member of that organization");
  await db.update(sessions).set({ activeOrganizationId: orgId }).where(eq(sessions.id, sessionId));
}

async function targetAndOwnerCount(
  db: Db,
  orgId: string,
  memberId: string,
): Promise<{ target: { id: string; role: Role }; ownerCount: number }> {
  const rows = await db
    .select({ id: memberships.id, role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.id, memberId), eq(memberships.organizationId, orgId)))
    .limit(1);
  if (!rows[0]) throw new NotFoundError("member not found");
  const owners = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.organizationId, orgId), eq(memberships.role, "owner")));
  return { target: { id: rows[0].id, role: rows[0].role as Role }, ownerCount: owners.length };
}

function assertAllowed(result: { ok: true } | { ok: false; code: string }): void {
  if (result.ok) return;
  const status = result.code === "member.last_owner" ? 409 : 403;
  throw new AppError(
    result.code === "member.last_owner"
      ? "an organization must keep at least one owner"
      : "your role cannot manage this member",
    { status, code: result.code },
  );
}

export async function changeMemberRole(
  db: Db,
  orgId: string,
  actorRole: Role,
  memberId: string,
  newRole: Role,
): Promise<MemberView> {
  const { target, ownerCount } = await targetAndOwnerCount(db, orgId, memberId);
  assertAllowed(memberChangeCheck({ actorRole, targetRole: target.role, newRole, ownerCount }));
  await db.update(memberships).set({ role: newRole }).where(eq(memberships.id, target.id));
  const all = await listMembers(db, orgId);
  return all.find((m) => m.id === target.id)!;
}

export async function removeMember(
  db: Db,
  orgId: string,
  actorRole: Role,
  memberId: string,
): Promise<void> {
  const { target, ownerCount } = await targetAndOwnerCount(db, orgId, memberId);
  assertAllowed(memberChangeCheck({ actorRole, targetRole: target.role, ownerCount }));
  await db.delete(memberships).where(eq(memberships.id, target.id));
}
