import { describe, expect, it } from "vitest";

import { metricsAccess } from "./prometheus.js";

// The /metrics exposition carries per-app series across all orgs, so access is
// token-gated in production and fails closed when no token is set.
describe("metricsAccess", () => {
  it("with a token: allows the exact bearer, refuses everything else (401)", () => {
    const token = "s3cret";
    expect(metricsAccess({ token, authorization: "Bearer s3cret", nodeEnv: "production" })).toEqual(
      {
        ok: true,
      },
    );
    expect(metricsAccess({ token, authorization: undefined, nodeEnv: "production" })).toEqual({
      ok: false,
      status: 401,
      error: "unauthorized",
    });
    expect(metricsAccess({ token, authorization: "Bearer wrong", nodeEnv: "development" })).toEqual(
      {
        ok: false,
        status: 401,
        error: "unauthorized",
      },
    );
  });

  it("no token in production: fails closed (503) rather than leaking cross-tenant data", () => {
    const r = metricsAccess({ token: undefined, authorization: undefined, nodeEnv: "production" });
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ status: 503 });
  });

  it("no token in dev/test: open for local scraping", () => {
    expect(
      metricsAccess({ token: undefined, authorization: undefined, nodeEnv: "development" }),
    ).toEqual({ ok: true });
    expect(metricsAccess({ token: undefined, authorization: undefined, nodeEnv: "test" })).toEqual({
      ok: true,
    });
  });
});
