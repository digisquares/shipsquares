import { AppError, NotFoundError, ValidationError, newId } from "@ss/shared";
import type { Env } from "@ss/shared";
import { and, desc, eq } from "drizzle-orm";

import type { Db } from "../db/index.js";
import { memberships, orgInvites, organizations } from "../db/schema/index.js";
import type { Role } from "../lib/ctx.js";
import {
  acceptDecision,
  hashInviteToken,
  inviteRoleAllowed,
  newInviteToken,
} from "../members/invite.js";
import { sendEmail, smtpTransport } from "../notifications/drivers.js";

// Member invites (R3.4): an admin/owner creates an expiring, emailed,
// single-use invite at a pre-assigned role; the invitee (logged in with the
// matching email) accepts and a membership is minted. Email is best-effort —
// the accept URL is also returned so an operator can deliver it out of band.

const TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface InviteView {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: string;
  createdAt: string;
}

function toView(r: typeof orgInvites.$inferSelect): InviteView {
  return {
    id: r.id,
    email: r.email,
    role: r.role,
    status: r.status,
    expiresAt: r.expiresAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
  };
}

function acceptUrl(config: Env, token: string): string {
  return `${config.AUTH_URL.replace(/\/$/, "")}/#/invite?token=${token}`;
}

export async function listInvites(db: Db, orgId: string): Promise<InviteView[]> {
  const rows = await db
    .select()
    .from(orgInvites)
    .where(and(eq(orgInvites.organizationId, orgId), eq(orgInvites.status, "pending")))
    .orderBy(desc(orgInvites.createdAt));
  return rows.map(toView);
}

export async function createInvite(
  db: Db,
  config: Env,
  orgId: string,
  actorRole: Role,
  invitedByUserId: string | undefined,
  input: { email: string; role: Role; now?: number },
): Promise<InviteView & { acceptUrl: string; emailed: boolean }> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ValidationError("invalid email");
  if (!inviteRoleAllowed(actorRole, input.role)) {
    throw new AppError("your role cannot invite a member at that role", {
      status: 403,
      code: "invite.role_forbidden",
    });
  }
  const { token, tokenHash } = newInviteToken();
  const now = input.now ?? Date.now();
  const rows = await db
    .insert(orgInvites)
    .values({
      id: newId("inv"),
      organizationId: orgId,
      email,
      role: input.role,
      tokenHash,
      ...(invitedByUserId ? { invitedByUserId } : {}),
      expiresAt: new Date(now + TTL_MS),
    })
    .returning();
  const url = acceptUrl(config, token);

  // Best-effort delivery — the URL is returned regardless so the inviter can
  // copy it (the email driver only works once SMTP is configured).
  let emailed = false;
  if (config.SMTP_URL && config.SMTP_FROM) {
    const org = (
      await db
        .select({ name: organizations.name })
        .from(organizations)
        .where(eq(organizations.id, orgId))
        .limit(1)
    )[0];
    const res = await sendEmail(smtpTransport(config.SMTP_URL), {
      from: config.SMTP_FROM,
      to: email,
      subject: `You're invited to ${org?.name ?? "a ShipSquares org"}`,
      text: `You've been invited to join ${org?.name ?? "an organization"} on ShipSquares as ${input.role}.\n\nAccept: ${url}\n\nThis invite expires in 7 days.`,
    });
    emailed = res.ok;
  }
  return { ...toView(rows[0]!), acceptUrl: url, emailed };
}

export async function revokeInvite(db: Db, orgId: string, id: string): Promise<void> {
  const rows = await db
    .update(orgInvites)
    .set({ status: "revoked" })
    .where(
      and(
        eq(orgInvites.id, id),
        eq(orgInvites.organizationId, orgId),
        eq(orgInvites.status, "pending"),
      ),
    )
    .returning({ id: orgInvites.id });
  if (!rows[0]) throw new NotFoundError("pending invite not found");
}

/** Accept an invite as the logged-in user. Authenticated but NOT org-scoped:
 *  a brand-new user accepting their first invite has no membership yet. */
export async function acceptInvite(
  db: Db,
  token: string,
  actor: { userId: string; email: string },
): Promise<{ organizationId: string; role: string }> {
  const invite = (
    await db
      .select()
      .from(orgInvites)
      .where(eq(orgInvites.tokenHash, hashInviteToken(token)))
      .limit(1)
  )[0];
  if (!invite) throw new NotFoundError("invite not found");

  const decision = acceptDecision({
    status: invite.status,
    expiresAt: invite.expiresAt.getTime(),
    inviteEmail: invite.email,
    actorEmail: actor.email,
    now: Date.now(),
  });
  if (decision !== "accept") {
    const map: Record<string, { status: number; code: string; msg: string }> = {
      expired: { status: 410, code: "invite.expired", msg: "this invite has expired" },
      not_pending: {
        status: 409,
        code: "invite.not_pending",
        msg: "this invite is no longer valid",
      },
      email_mismatch: {
        status: 403,
        code: "invite.email_mismatch",
        msg: "this invite was sent to a different email address",
      },
    };
    const e = map[decision]!;
    throw new AppError(e.msg, { status: e.status, code: e.code });
  }

  // Idempotent on membership: a user already in the org just gets the invite
  // marked accepted (no duplicate row, no role downgrade surprise).
  const existing = (
    await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, actor.userId),
          eq(memberships.organizationId, invite.organizationId),
        ),
      )
      .limit(1)
  )[0];
  if (!existing) {
    await db.insert(memberships).values({
      id: newId("mbr"),
      organizationId: invite.organizationId,
      userId: actor.userId,
      role: invite.role,
    });
  }
  await db
    .update(orgInvites)
    .set({ status: "accepted", acceptedByUserId: actor.userId })
    .where(eq(orgInvites.id, invite.id));
  return { organizationId: invite.organizationId, role: invite.role };
}
