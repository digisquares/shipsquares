import { describe, expect, it } from "vitest";

import { missingSecrets, parseConfigFile, toConfigFile } from "./schema.js";

describe("app config (shipsquares.yml)", () => {
  it("parses a valid config and applies defaults", () => {
    const cfg = parseConfigFile({
      name: "my-api",
      server: "prod-1",
      repo: "github.com/acme/my-api",
      build: { type: "dockerfile", dockerfile: "./Dockerfile" },
      env: { clear: { PORT: "3000" }, secret: ["DB_PASSWORD"] },
    });
    expect(cfg.branch).toBe("main");
    expect(cfg.env.secret).toEqual(["DB_PASSWORD"]);
  });

  it("rejects an invalid build type", () => {
    expect(() =>
      parseConfigFile({ name: "x", server: "s", repo: "r", build: { type: "bazel" } }),
    ).toThrow();
  });

  it("export emits secrets by NAME only — never a value", () => {
    const file = toConfigFile({
      name: "my-api",
      server: "prod-1",
      repo: "r",
      branch: "main",
      build: { type: "dockerfile" },
      clearEnv: { NODE_ENV: "production" },
      secretNames: ["DB_PASSWORD", "STRIPE"],
    });
    expect(file.env.secret).toEqual(["DB_PASSWORD", "STRIPE"]);
    expect(JSON.stringify(file)).not.toContain("s3cr3t");
  });

  it("flags referenced-but-absent secrets on import", () => {
    const file = parseConfigFile({
      name: "x",
      server: "s",
      repo: "r",
      build: { type: "compose" },
      env: { clear: {}, secret: ["A", "B", "C"] },
    });
    expect(missingSecrets(file, new Set(["A"]))).toEqual(["B", "C"]);
  });
});
