import { describe, expect, it } from "vitest";

import { buildNixpacksArgs } from "./nixpacks.js";

describe("buildNixpacksArgs", () => {
  it("builds the nixpacks command (name, no-cache, env) per Dokploy", () => {
    expect(
      buildNixpacksArgs({
        appName: "web",
        workDir: "/src",
        envVars: ["NODE_ENV=production"],
        noCache: true,
      }),
    ).toEqual(["build", "/src", "--name", "web", "--no-cache", "--env", "NODE_ENV=production"]);
  });

  it("adds --no-error-without-start for static output", () => {
    expect(buildNixpacksArgs({ appName: "site", workDir: ".", noErrorWithoutStart: true })).toEqual(
      ["build", ".", "--name", "site", "--no-error-without-start"],
    );
  });
});
