import { beforeEach, describe, expect, it } from "vitest";

import { EnvSchema, loadConfig, resetConfigCache } from "./env.js";

const validEnv = {
  NODE_ENV: "test",
  PORT: "8080",
  DATABASE_URL: "postgres://localhost:5432/shipsquares_test",
  AUTH_SECRET: "x".repeat(32),
  AUTH_URL: "http://localhost:3000",
} satisfies Record<string, string>;

beforeEach(() => resetConfigCache());

describe("EnvSchema", () => {
  it("accepts a complete valid env and coerces PORT to a number", () => {
    const parsed = EnvSchema.parse(validEnv);
    expect(parsed.PORT).toBe(8080);
    expect(typeof parsed.PORT).toBe("number");
  });

  it("rejects a missing DATABASE_URL / AUTH_SECRET / AUTH_URL and reports each path", () => {
    const res = EnvSchema.safeParse({ NODE_ENV: "test" });
    expect(res.success).toBe(false);
    if (!res.success) {
      const paths = res.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("DATABASE_URL");
      expect(paths).toContain("AUTH_SECRET");
      expect(paths).toContain("AUTH_URL");
    }
  });

  it("rejects malformed values", () => {
    expect(EnvSchema.safeParse({ ...validEnv, DATABASE_URL: "not-a-url" }).success).toBe(false);
    expect(EnvSchema.safeParse({ ...validEnv, AUTH_SECRET: "tooshort" }).success).toBe(false);
    expect(EnvSchema.safeParse({ ...validEnv, PROXY_DRIVER: "envoy" }).success).toBe(false);
    expect(EnvSchema.safeParse({ ...validEnv, LOG_LEVEL: "loud" }).success).toBe(false);
  });

  it("applies defaults when optional keys are omitted", () => {
    const parsed = EnvSchema.parse({
      DATABASE_URL: validEnv.DATABASE_URL,
      AUTH_SECRET: validEnv.AUTH_SECRET,
      AUTH_URL: validEnv.AUTH_URL,
    });
    expect(parsed.NODE_ENV).toBe("development");
    expect(parsed.PORT).toBe(3000);
    expect(parsed.CADDY_ADMIN_URL).toBe("http://127.0.0.1:2019");
    expect(parsed.PROXY_DRIVER).toBe("caddy");
    expect(parsed.LOG_LEVEL).toBe("info");
  });
});

describe("loadConfig", () => {
  it("throws a single aggregated, multi-line error listing every issue", () => {
    let message = "";
    try {
      loadConfig({ NODE_ENV: "test" } as NodeJS.ProcessEnv);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain("Invalid environment configuration:");
    expect(message).toContain("DATABASE_URL");
    expect(message).toContain("AUTH_SECRET");
    expect(message).toContain("AUTH_URL");
    expect(message.split("\n").length).toBeGreaterThan(3);
  });

  it("is memoised: a second call returns the cache and ignores a changed source", () => {
    const first = loadConfig(validEnv as unknown as NodeJS.ProcessEnv);
    const second = loadConfig({ ...validEnv, PORT: "9999" } as unknown as NodeJS.ProcessEnv);
    expect(second).toBe(first);
    expect(second.PORT).toBe(8080);
  });
});
