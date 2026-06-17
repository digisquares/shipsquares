import { describe, expect, it } from "vitest";

import { memberChangeCheck } from "./member-guards.js";

describe("memberChangeCheck", () => {
  it("admins manage non-owners", () => {
    expect(
      memberChangeCheck({
        actorRole: "admin",
        targetRole: "viewer",
        newRole: "deployer",
        ownerCount: 1,
      }),
    ).toEqual({ ok: true });
    expect(
      memberChangeCheck({ actorRole: "admin", targetRole: "deployer", ownerCount: 1 }),
    ).toEqual({ ok: true }); // removal
  });

  it("only owners may touch owners", () => {
    const r = memberChangeCheck({
      actorRole: "admin",
      targetRole: "owner",
      newRole: "viewer",
      ownerCount: 2,
    });
    expect(r).toEqual({ ok: false, code: "member.owner_requires_owner" });
    expect(
      memberChangeCheck({
        actorRole: "owner",
        targetRole: "owner",
        newRole: "admin",
        ownerCount: 2,
      }),
    ).toEqual({ ok: true });
  });

  it("the last owner can never be demoted or removed", () => {
    expect(
      memberChangeCheck({
        actorRole: "owner",
        targetRole: "owner",
        newRole: "admin",
        ownerCount: 1,
      }),
    ).toEqual({ ok: false, code: "member.last_owner" });
    expect(memberChangeCheck({ actorRole: "owner", targetRole: "owner", ownerCount: 1 })).toEqual({
      ok: false,
      code: "member.last_owner",
    });
    // promoting ANOTHER member to owner is fine with one owner
    expect(
      memberChangeCheck({
        actorRole: "owner",
        targetRole: "viewer",
        newRole: "owner",
        ownerCount: 1,
      }),
    ).toEqual({ ok: true });
  });

  it("deployers/viewers cannot manage members at all", () => {
    expect(
      memberChangeCheck({
        actorRole: "deployer",
        targetRole: "viewer",
        newRole: "viewer",
        ownerCount: 1,
      }),
    ).toEqual({ ok: false, code: "member.actor_role" });
  });
});
