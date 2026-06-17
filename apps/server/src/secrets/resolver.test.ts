import { describe, expect, it } from "vitest";

import { resolveEnv } from "./resolver.js";

const vault: Record<string, string> = {
  DB_PASSWORD: "s3cr3t",
  STRIPE: "sk_live_xyz",
};
const openSecret = (name: string) => vault[name] ?? "";

describe("resolveEnv", () => {
  it("merges clear env with dereferenced secret refs and collects redactSet", () => {
    const { values, redactSet } = resolveEnv({
      clear: { NODE_ENV: "production" },
      secretRefs: [{ key: "STRIPE_KEY", ref: "STRIPE" }],
      openSecret,
    });
    expect(values).toEqual({ NODE_ENV: "production", STRIPE_KEY: "sk_live_xyz" });
    expect(redactSet.has("sk_live_xyz")).toBe(true);
  });

  it("expands ${secret:NAME} tokens inside clear values and redacts them", () => {
    const { values, redactSet } = resolveEnv({
      clear: { DATABASE_URL: "postgres://app:${secret:DB_PASSWORD}@db/app" },
      secretRefs: [],
      openSecret,
    });
    expect(values.DATABASE_URL).toBe("postgres://app:s3cr3t@db/app");
    expect(redactSet.has("s3cr3t")).toBe(true);
  });

  it("layers shared vars under the app's own clear env (app wins)", () => {
    const { values } = resolveEnv({
      clear: { PORT: "3000" },
      secretRefs: [],
      shared: { PORT: "8080", REGION: "eu" },
      openSecret,
    });
    expect(values).toEqual({ PORT: "3000", REGION: "eu" });
  });

  it("dereferences shared secret refs into values + redactSet", () => {
    const { values, redactSet } = resolveEnv({
      clear: {},
      secretRefs: [],
      sharedSecretRefs: [{ key: "DB", ref: "DB_PASSWORD" }],
      openSecret,
    });
    expect(values.DB).toBe("s3cr3t");
    expect(redactSet.has("s3cr3t")).toBe(true);
  });
});
