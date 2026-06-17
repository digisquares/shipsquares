import { describe, expect, it } from "vitest";

import { corsOrigins, requestBaseUrl, trustedOriginsFor } from "./cors-origins.js";

describe("corsOrigins", () => {
  it("production: only the AUTH_URL origin", () => {
    expect(corsOrigins({ AUTH_URL: "https://ship.example.com", NODE_ENV: "production" })).toEqual([
      "https://ship.example.com",
    ]);
  });

  it("strips any path from AUTH_URL", () => {
    expect(
      corsOrigins({ AUTH_URL: "https://ship.example.com/auth", NODE_ENV: "production" }),
    ).toEqual(["https://ship.example.com"]);
  });

  it("development adds the Vite dev origins (deduped)", () => {
    const origins = corsOrigins({ AUTH_URL: "http://localhost:5173", NODE_ENV: "development" });
    expect(origins).toContain("http://localhost:5173");
    expect(origins).toContain("http://127.0.0.1:5173");
    expect(origins.filter((o) => o === "http://localhost:5173")).toHaveLength(1);
  });

  it("never reflects arbitrary origins (allowlist only)", () => {
    const origins = corsOrigins({ AUTH_URL: "https://ship.example.com", NODE_ENV: "production" });
    expect(origins).not.toContain("https://attacker.example");
    expect(origins).toHaveLength(1);
  });

  it("AUTH_TRUSTED_ORIGINS adds extra explicit origins (IP access, tunnels)", () => {
    const origins = corsOrigins({
      AUTH_URL: "http://203.0.113.9:3000",
      AUTH_TRUSTED_ORIGINS: " http://localhost:3000 , https://ship.example.com/ignored-path ",
      NODE_ENV: "production",
    });
    expect(origins).toEqual([
      "http://203.0.113.9:3000",
      "http://localhost:3000",
      "https://ship.example.com",
    ]);
  });

  it("drops malformed AUTH_TRUSTED_ORIGINS entries instead of widening the allowlist", () => {
    const origins = corsOrigins({
      AUTH_URL: "https://ship.example.com",
      AUTH_TRUSTED_ORIGINS: "not a url,,*",
      NODE_ENV: "production",
    });
    expect(origins).toEqual(["https://ship.example.com"]);
  });
});

describe("requestBaseUrl", () => {
  it("builds the base from the real Host header (server-IP access)", () => {
    expect(requestBaseUrl({ host: "203.0.113.9:3000" }, "http", "https://ship.example.com")).toBe(
      "http://203.0.113.9:3000",
    );
  });

  it("honors x-forwarded-proto from the edge proxy (first value wins)", () => {
    expect(
      requestBaseUrl(
        { host: "ship.example.com", "x-forwarded-proto": "https, http" },
        "http",
        "https://fallback.example",
      ),
    ).toBe("https://ship.example.com");
  });

  it("falls back to the AUTH_URL origin when Host is missing", () => {
    expect(requestBaseUrl({}, "http", "https://ship.example.com/path")).toBe(
      "https://ship.example.com",
    );
  });
});

describe("trustedOriginsFor", () => {
  const config = {
    AUTH_URL: "https://ship.example.com",
    NODE_ENV: "production" as const,
  };

  it("always trusts the request's own origin — dashboard works at any host", () => {
    const origins = trustedOriginsFor(config)(
      new Request("http://203.0.113.9:3000/auth/sign-in/email", { method: "POST" }),
    );
    expect(origins).toContain("https://ship.example.com"); // the allowlist
    expect(origins).toContain("http://203.0.113.9:3000"); // same-origin request
  });

  it("does not duplicate the allowlisted origin and never adds a foreign one", () => {
    const origins = trustedOriginsFor(config)(
      new Request("https://ship.example.com/auth/sign-in/email"),
    );
    expect(origins.filter((o) => o === "https://ship.example.com")).toHaveLength(1);
    expect(origins).not.toContain("https://attacker.example");
  });
});
