import { describe, expect, it } from "vitest";

import { buildPackArgs, DEFAULT_BUILDER } from "./buildpacks.js";

describe("buildPackArgs", () => {
  it("builds the image from the context with the default builder", () => {
    expect(buildPackArgs({ imageRef: "ss-app:abc", context: "/work" })).toEqual([
      "build",
      "ss-app:abc",
      "--path",
      "/work",
      "--builder",
      DEFAULT_BUILDER,
    ]);
  });

  it("honors a custom builder and passes env as --env K=V", () => {
    const args = buildPackArgs({
      imageRef: "ss-app:abc",
      context: "/work",
      builder: "heroku/builder:24",
      envVars: ["NODE_ENV=production", "PORT=8080"],
    });
    expect(args).toContain("heroku/builder:24");
    expect(args).toContain("--env");
    expect(args).toContain("NODE_ENV=production");
    expect(args).toContain("PORT=8080");
    // the default builder must NOT appear when one is given
    expect(args.filter((a) => a === DEFAULT_BUILDER)).toHaveLength(0);
  });

  it("adds --clear-cache when noCache is set", () => {
    expect(buildPackArgs({ imageRef: "i", context: "/w", noCache: true })).toContain(
      "--clear-cache",
    );
  });
});
