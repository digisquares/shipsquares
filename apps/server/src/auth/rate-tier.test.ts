import { describe, expect, it } from "vitest";

import { AUTH_SENSITIVE_MAX, authRateMax } from "./rate-tier.js";

const DEFAULT = 1000;

describe("authRateMax", () => {
  it("tightly limits credential-submitting endpoints", () => {
    for (const url of [
      "/auth/sign-in/email",
      "/auth/sign-up/email",
      "/auth/two-factor/verify-totp",
      "/auth/forget-password",
      "/auth/reset-password",
      "/auth/verify-email?token=abc",
      "/auth/change-password",
    ]) {
      expect(authRateMax(url, DEFAULT)).toBe(AUTH_SENSITIVE_MAX);
    }
  });

  it("leaves high-frequency reads on the default budget", () => {
    for (const url of ["/auth/get-session", "/auth/list-sessions", "/auth/ok"]) {
      expect(authRateMax(url, DEFAULT)).toBe(DEFAULT);
    }
  });

  it("is case-insensitive and ignores the querystring", () => {
    expect(authRateMax("/auth/Sign-In/Email?redirect=/x", DEFAULT)).toBe(AUTH_SENSITIVE_MAX);
  });
});
