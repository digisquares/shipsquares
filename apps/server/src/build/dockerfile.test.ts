import { describe, expect, it } from "vitest";

import { buildDockerfileArgs } from "./dockerfile.js";

describe("buildDockerfileArgs", () => {
  it("emits the expected docker build argv with build-args and secrets", () => {
    const args = buildDockerfileArgs({
      imageRef: "myapp:9f2c1ab",
      dockerfile: "Dockerfile",
      context: ".",
      buildArgs: { NODE_ENV: "production" },
      secretEnvKeys: ["NPM_TOKEN"],
      target: "runner",
      noCache: true,
    });
    expect(args).toEqual([
      "build",
      "-t",
      "myapp:9f2c1ab",
      "-f",
      "Dockerfile",
      ".",
      "--target",
      "runner",
      "--no-cache",
      "--build-arg",
      "NODE_ENV=production",
      "--secret",
      "type=env,id=NPM_TOKEN",
    ]);
  });

  it("never puts a secret VALUE in the argv — only the id", () => {
    const args = buildDockerfileArgs({
      imageRef: "app:1",
      dockerfile: "Dockerfile",
      context: ".",
      secretEnvKeys: ["API_KEY"],
    });
    const joined = args.join(" ");
    expect(joined).toContain("type=env,id=API_KEY");
    expect(joined).not.toContain("super-secret-value");
  });

  it("omits optional flags when not provided", () => {
    expect(
      buildDockerfileArgs({ imageRef: "app:1", dockerfile: "Dockerfile", context: "." }),
    ).toEqual(["build", "-t", "app:1", "-f", "Dockerfile", "."]);
  });
});
