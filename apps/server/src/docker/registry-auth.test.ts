import { describe, expect, it } from "vitest";

import { dockerLoginCommand, dockerLogoutCommand } from "./registry-auth.js";

describe("dockerLoginCommand", () => {
  it("pipes the password via stdin (never argv-visible)", () => {
    expect(dockerLoginCommand({ registry: "ghcr.io", username: "bot", password: "p@ss" })).toBe(
      "printf %s 'p@ss' | docker login 'ghcr.io' -u 'bot' --password-stdin",
    );
  });

  it("escapes quotes in every field (exact escaped form)", () => {
    expect(dockerLoginCommand({ registry: "ghcr.io", username: "bo't", password: "p'w" })).toBe(
      "printf %s 'p'\\''w' | docker login 'ghcr.io' -u 'bo'\\''t' --password-stdin",
    );
  });

  it("docker hub: empty registry logs into the default", () => {
    expect(dockerLoginCommand({ registry: "", username: "u", password: "p" })).toBe(
      "printf %s 'p' | docker login -u 'u' --password-stdin",
    );
  });
});

describe("dockerLogoutCommand", () => {
  it("logs out of the named registry (or the default)", () => {
    expect(dockerLogoutCommand("ghcr.io")).toBe("docker logout 'ghcr.io'");
    expect(dockerLogoutCommand("")).toBe("docker logout");
  });
});
