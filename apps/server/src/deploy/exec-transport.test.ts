import { describe, expect, it, vi } from "vitest";

import { chooseExecLocation, localTarget, resolveExecTarget } from "./exec-target.js";
import { composeRemoteCommand, type ExecResult, makeRemoteExec, shellQuote } from "./exec.js";

describe("shellQuote", () => {
  it("wraps in single quotes and escapes embedded quotes", () => {
    expect(shellQuote("simple")).toBe("'simple'");
    expect(shellQuote("a b c")).toBe("'a b c'");
    // an embedded ' must close/escape/reopen so injection can't break out
    expect(shellQuote("rm -rf /'; echo pwned")).toBe("'rm -rf /'\\''; echo pwned'");
  });
});

describe("composeRemoteCommand", () => {
  it("quotes cmd + args into one shell line", () => {
    expect(composeRemoteCommand("docker", ["build", "-t", "my app", "."])).toBe(
      "'docker' 'build' '-t' 'my app' '.'",
    );
  });

  it("prefixes a cwd (cd && …) and env assignments, all quoted", () => {
    const line = composeRemoteCommand("docker", ["build", "."], {
      cwd: "/srv/builds/d 1",
      env: { DOCKER_HOST: "ssh://w@h", SKIP: undefined },
    });
    expect(line).toBe("cd '/srv/builds/d 1' && DOCKER_HOST='ssh://w@h' 'docker' 'build' '.'");
    // a value-less env var is dropped, not emitted as `VAR=`
    expect(line).not.toContain("SKIP=");
  });
});

describe("makeRemoteExec", () => {
  it("composes the command, forwards onLine/timeout, returns the runner's ExecResult", async () => {
    const result: ExecResult = { code: 0, lines: [{ stream: "stdout", line: "ok" }] };
    const run = vi.fn(async () => result);
    const onLine = vi.fn();
    const exec = makeRemoteExec(run as unknown as Parameters<typeof makeRemoteExec>[0]);
    const got = await exec("git", ["clone", "url"], { cwd: "/w", onLine, timeoutMs: 5000 });
    expect(got).toBe(result);
    expect(run).toHaveBeenCalledWith("cd '/w' && 'git' 'clone' 'url'", { onLine, timeoutMs: 5000 });
  });
});

describe("exec-target selection", () => {
  const remoteFactory = () => localExecMarker;
  const localExecMarker = vi.fn();

  it("runs locally for a null server, the control server, or localhost", () => {
    expect(chooseExecLocation(null)).toBe("local");
    expect(chooseExecLocation({ host: "10.0.0.5", sshUser: "x", role: "control" })).toBe("local");
    expect(chooseExecLocation({ host: "127.0.0.1", sshUser: "x" })).toBe("local");
    expect(chooseExecLocation({ host: "localhost", sshUser: "x" })).toBe("local");
  });

  it("runs remotely for a worker server", () => {
    expect(chooseExecLocation({ host: "4.5.6.7", sshUser: "deploy", role: "worker" })).toBe(
      "remote",
    );
  });

  it("localTarget probes/proxies 127.0.0.1; remote target uses the server host", () => {
    expect(localTarget()).toMatchObject({ host: "127.0.0.1", remote: false });
    const t = resolveExecTarget(
      { host: "4.5.6.7", sshUser: "deploy", role: "worker" },
      remoteFactory,
    );
    expect(t).toMatchObject({ host: "4.5.6.7", remote: true });
    expect(t.exec).toBe(localExecMarker);
  });
});
