import { describe, expect, it } from "vitest";

import { acceptDecision, hashInviteToken, inviteRoleAllowed, newInviteToken } from "./invite.js";

describe("newInviteToken / hashInviteToken", () => {
  it("mints a long opaque token whose stored hash is deterministic and not the token", () => {
    const { token, tokenHash } = newInviteToken();
    expect(token).toMatch(/^[0-9a-f]{48,}$/);
    expect(tokenHash).toBe(hashInviteToken(token));
    expect(tokenHash).not.toBe(token);
  });

  it("different tokens hash differently", () => {
    expect(newInviteToken().tokenHash).not.toBe(newInviteToken().tokenHash);
  });
});

describe("inviteRoleAllowed", () => {
  it("owners may invite any role; admins may not mint owners/admins", () => {
    expect(inviteRoleAllowed("owner", "owner")).toBe(true);
    expect(inviteRoleAllowed("owner", "admin")).toBe(true);
    expect(inviteRoleAllowed("admin", "deployer")).toBe(true);
    expect(inviteRoleAllowed("admin", "viewer")).toBe(true);
    expect(inviteRoleAllowed("admin", "owner")).toBe(false);
    expect(inviteRoleAllowed("admin", "admin")).toBe(false);
  });
});

describe("acceptDecision", () => {
  const NOW = 1_000_000_000;
  const base = {
    status: "pending" as const,
    expiresAt: NOW + 60_000,
    inviteEmail: "ada@x.io",
    actorEmail: "ada@x.io",
    now: NOW,
  };

  it("accepts a pending, unexpired invite whose email matches (case-insensitive)", () => {
    expect(acceptDecision(base)).toBe("accept");
    expect(acceptDecision({ ...base, actorEmail: "ADA@X.IO" })).toBe("accept");
  });

  it("rejects an expired invite", () => {
    expect(acceptDecision({ ...base, expiresAt: NOW - 1 })).toBe("expired");
  });

  it("rejects a revoked or already-accepted invite", () => {
    expect(acceptDecision({ ...base, status: "revoked" })).toBe("not_pending");
    expect(acceptDecision({ ...base, status: "accepted" })).toBe("not_pending");
  });

  it("rejects when the logged-in email differs from the invited address", () => {
    expect(acceptDecision({ ...base, actorEmail: "eve@x.io" })).toBe("email_mismatch");
  });
});
