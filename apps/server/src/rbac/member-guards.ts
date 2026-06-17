import type { Role } from "../lib/ctx.js";

// Member-management invariants (04/05): admins manage non-owners, owners
// manage everyone, and the last owner can never be demoted or removed — an
// org without an owner is unrecoverable. Pure; the service supplies counts.

export type MemberChangeResult = { ok: true } | { ok: false; code: string };

export function memberChangeCheck(input: {
  actorRole: Role;
  targetRole: Role;
  /** the new role, or undefined when the target is being removed */
  newRole?: Role;
  ownerCount: number;
}): MemberChangeResult {
  if (input.actorRole !== "owner" && input.actorRole !== "admin") {
    return { ok: false, code: "member.actor_role" };
  }
  if (input.targetRole === "owner" && input.actorRole !== "owner") {
    return { ok: false, code: "member.owner_requires_owner" };
  }
  const demotesOwner = input.targetRole === "owner" && input.newRole !== "owner";
  if (demotesOwner && input.ownerCount <= 1) {
    return { ok: false, code: "member.last_owner" };
  }
  return { ok: true };
}
