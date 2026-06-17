import { describe, expect, it } from "vitest";

import { signInstallState, verifyInstallState } from "./install-state.js";

const SECRET = "app-state-secret";
const payload = { orgId: "org_1", nonce: "abc123", ts: 1_000_000 };

describe("install-state sign/verify", () => {
  it("round-trips a valid state", () => {
    const state = signInstallState(payload, SECRET);
    expect(verifyInstallState(state, SECRET, payload.ts + 5_000)).toEqual(payload);
  });

  it("rejects a tampered body (CSRF / org swap)", () => {
    const state = signInstallState(payload, SECRET);
    const forged = signInstallState({ ...payload, orgId: "org_attacker" }, SECRET).split(".")[0]!;
    const tampered = `${forged}.${state.split(".")[1]}`;
    expect(verifyInstallState(tampered, SECRET, payload.ts + 5_000)).toBeNull();
  });

  it("rejects a foreign signing secret", () => {
    const state = signInstallState(payload, SECRET);
    expect(verifyInstallState(state, "other-secret", payload.ts + 5_000)).toBeNull();
  });

  it("rejects an expired state", () => {
    const state = signInstallState(payload, SECRET);
    expect(verifyInstallState(state, SECRET, payload.ts + 11 * 60_000)).toBeNull();
  });

  it("rejects an implausibly future-dated state", () => {
    const state = signInstallState(payload, SECRET);
    expect(verifyInstallState(state, SECRET, payload.ts - 5 * 60_000)).toBeNull();
  });

  it("rejects malformed input", () => {
    expect(verifyInstallState("not-a-state", SECRET, payload.ts)).toBeNull();
    expect(verifyInstallState("", SECRET, payload.ts)).toBeNull();
    expect(verifyInstallState("abc.", SECRET, payload.ts)).toBeNull();
  });
});
