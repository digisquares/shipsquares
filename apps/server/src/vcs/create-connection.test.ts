import { describe, expect, it } from "vitest";

import { toCreateInput } from "./create-connection.js";

const seal = (plain: string) => `sealed(${plain})`;

describe("toCreateInput", () => {
  it("oauth: seals the serialized credential (token + refresh + parsed expiry)", () => {
    const input = toCreateInput(
      {
        kind: "oauth",
        provider: "github",
        accountLogin: "dev",
        token: "gho_abc",
        refreshToken: "r1",
        expiresAt: "2026-06-10T12:00:00.000Z",
      },
      seal,
    );
    expect(input.kind).toBe("oauth");
    expect(input.tokenSecretRef).toBe(
      `sealed({"accessToken":"gho_abc","refreshToken":"r1","expiresAt":${Date.parse(
        "2026-06-10T12:00:00.000Z",
      )}})`,
    );
  });

  it("oauth: ignores an unparseable expiry and omits absent fields", () => {
    const input = toCreateInput(
      { kind: "oauth", provider: "gitlab", accountLogin: "dev", token: "t", expiresAt: "nope" },
      seal,
    );
    expect(input.tokenSecretRef).toBe(`sealed({"accessToken":"t"})`);
  });

  it("manual: seals the raw credential", () => {
    const input = toCreateInput(
      { kind: "manual", provider: "generic", accountLogin: "ops", credential: "PAT-or-ssh-key" },
      seal,
    );
    expect(input).toEqual({
      provider: "generic",
      kind: "manual",
      accountLogin: "ops",
      tokenSecretRef: "sealed(PAT-or-ssh-key)",
    });
  });

  it("never passes the plaintext through unsealed", () => {
    const input = toCreateInput(
      { kind: "manual", provider: "github", accountLogin: "a", credential: "raw-secret" },
      seal,
    );
    expect(JSON.stringify(input)).not.toContain('"raw-secret"');
  });
});
