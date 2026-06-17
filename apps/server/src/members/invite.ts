import { createHash, randomBytes } from "node:crypto";

import type { Role } from "../lib/ctx.js";

// Member-invite cores (ROADMAP R3.4). Pure + crypto only — the service binds
// the DB, email, and membership creation. The link carries a high-entropy
// token; only its sha256 hash is stored, and acceptance is gated on
// pending + unexpired + the logged-in email matching the invited address.

export type InviteStatus = "pending" | "accepted" | "revoked";

export function newInviteToken(): { token: string; tokenHash: string } {
  const token = randomBytes(24).toString("hex");
  return { token, tokenHash: hashInviteToken(token) };
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Who may invite whom: owners invite anyone; admins may not mint
 *  owners or admins (privilege-escalation floor, mirrors member-guards). */
export function inviteRoleAllowed(actorRole: Role, inviteRole: Role): boolean {
  if (actorRole === "owner") return true;
  if (actorRole === "admin") return inviteRole === "deployer" || inviteRole === "viewer";
  return false;
}

export type AcceptDecision = "accept" | "expired" | "not_pending" | "email_mismatch";

export function acceptDecision(input: {
  status: InviteStatus;
  expiresAt: number;
  inviteEmail: string;
  actorEmail: string;
  now: number;
}): AcceptDecision {
  if (input.status !== "pending") return "not_pending";
  if (input.now > input.expiresAt) return "expired";
  if (input.inviteEmail.toLowerCase() !== input.actorEmail.toLowerCase()) return "email_mismatch";
  return "accept";
}
