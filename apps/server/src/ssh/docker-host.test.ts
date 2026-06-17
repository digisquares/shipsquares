import { describe, expect, it } from "vitest";

import { buildDockerHost, isLocal, poolKey } from "./docker-host.js";

describe("docker host / connection pool", () => {
  it("builds an ssh:// DOCKER_HOST, omitting the default port 22", () => {
    expect(buildDockerHost({ host: "10.0.0.5", sshUser: "deploy" })).toBe("ssh://deploy@10.0.0.5");
    expect(buildDockerHost({ host: "10.0.0.5", sshUser: "deploy", sshPort: 2222 })).toBe(
      "ssh://deploy@10.0.0.5:2222",
    );
  });

  it("keys the pool by user@host:port", () => {
    expect(poolKey({ host: "h", sshUser: "u" })).toBe("u@h:22");
    expect(poolKey({ host: "h", sshUser: "u", sshPort: 2200 })).toBe("u@h:2200");
  });

  it("treats the control server / loopback as local", () => {
    expect(isLocal({ host: "1.2.3.4", sshUser: "u", role: "control" })).toBe(true);
    expect(isLocal({ host: "localhost", sshUser: "u" })).toBe(true);
    expect(isLocal({ host: "10.0.0.5", sshUser: "u", role: "worker" })).toBe(false);
  });
});
