import { describe, expect, it } from "vitest";

import { defaultLocalHost, resolveTarget, type ServerTarget } from "./resolve-target.js";

const server: ServerTarget = { host: "10.0.0.5", sshUser: "deploy", sshKeyRef: "key_1" };

describe("defaultLocalHost", () => {
  it("is the named pipe on win32 and the unix socket elsewhere", () => {
    expect(defaultLocalHost("win32")).toBe("npipe:////./pipe/docker_engine");
    expect(defaultLocalHost("linux")).toBe("unix:///var/run/docker.sock");
  });
});

describe("resolveTarget", () => {
  it("maps a unix:// host to a local socket", () => {
    expect(resolveTarget({ ...server, dockerHost: "unix:///var/run/docker.sock" })).toEqual({
      kind: "local",
      socketPath: "/var/run/docker.sock",
    });
  });

  it("maps an npipe:// host to a local socket", () => {
    expect(resolveTarget({ ...server, dockerHost: "npipe:////./pipe/docker_engine" })).toEqual({
      kind: "local",
      socketPath: "//./pipe/docker_engine",
    });
  });

  it("maps ssh:// / tcp:// hosts to an ssh target", () => {
    expect(resolveTarget({ ...server, dockerHost: "ssh://deploy@10.0.0.5" })).toEqual({
      kind: "ssh",
      host: "10.0.0.5",
      user: "deploy",
      keyRef: "key_1",
    });
    expect(resolveTarget({ ...server, dockerHost: "tcp://10.0.0.5:2375" }).kind).toBe("ssh");
  });

  it("defaults to the local socket for the host OS when dockerHost is unset", () => {
    expect(resolveTarget(server, "linux")).toEqual({
      kind: "local",
      socketPath: "/var/run/docker.sock",
    });
    expect(resolveTarget(server, "win32")).toEqual({
      kind: "local",
      socketPath: "//./pipe/docker_engine",
    });
  });
});
