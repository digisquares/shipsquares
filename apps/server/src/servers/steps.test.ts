import { describe, expect, it, vi } from "vitest";

import { runBootstrap } from "./bootstrap.js";
import { buildBootstrapSteps, type RemoteExec } from "./steps.js";

function scriptedExec(codeFor: (command: string) => number): {
  exec: RemoteExec;
  commands: string[];
} {
  const commands: string[] = [];
  const exec: RemoteExec = async (command) => {
    commands.push(command);
    return { code: codeFor(command), lines: [] };
  };
  return { exec, commands };
}

describe("buildBootstrapSteps", () => {
  it("skips both steps on a host that already has docker + compose", async () => {
    const { exec, commands } = scriptedExec(() => 0);
    const results = await runBootstrap(buildBootstrapSteps(exec), () => undefined);
    expect(results).toEqual([
      { id: "docker", outcome: "skipped" },
      { id: "compose", outcome: "skipped" },
    ]);
    expect(commands.some((c) => c.includes("get.docker.com"))).toBe(false);
  });

  it("installs docker via get.docker.com on a bare host, then verifies", async () => {
    let installed = false;
    const { exec, commands } = scriptedExec((command) => {
      if (command.includes("get.docker.com")) {
        installed = true;
        return 0;
      }
      return installed ? 0 : 1;
    });
    const results = await runBootstrap(buildBootstrapSteps(exec), () => undefined);
    expect(results[0]).toEqual({ id: "docker", outcome: "applied" });
    expect(results[1]).toEqual({ id: "compose", outcome: "skipped" }); // plugin ships with it
    expect(commands.some((c) => c.includes("curl -fsSL https://get.docker.com"))).toBe(true);
  });

  it("fails the docker step (and halts) when the install script exits non-zero", async () => {
    const { exec } = scriptedExec((command) => (command.includes("get.docker.com") ? 127 : 1));
    const results = await runBootstrap(buildBootstrapSteps(exec), () => undefined);
    expect(results).toHaveLength(1);
    expect(results[0]?.outcome).toBe("failed");
    expect(results[0]?.error).toContain("exit 127");
  });

  it("installs the compose plugin explicitly when docker exists without it", async () => {
    let pluginInstalled = false;
    const { exec, commands } = scriptedExec((command) => {
      if (command.includes("docker-compose-plugin")) {
        pluginInstalled = true;
        return 0;
      }
      if (command.includes("docker compose version")) return pluginInstalled ? 0 : 1;
      return 0; // docker itself is present
    });
    const results = await runBootstrap(buildBootstrapSteps(exec), () => undefined);
    expect(results).toEqual([
      { id: "docker", outcome: "skipped" },
      { id: "compose", outcome: "applied" },
    ]);
    expect(commands.some((c) => c.includes("docker-compose-plugin"))).toBe(true);
  });

  it("streams apply output through the orchestrator log", async () => {
    const log = vi.fn();
    const exec: RemoteExec = async (command, opts) => {
      if (command.includes("get.docker.com")) {
        opts?.onLine?.("stdout", "# Executing docker install script");
        return { code: 0, lines: [] };
      }
      return { code: command.includes("docker compose version") ? 0 : 1, lines: [] };
    };
    // docker probe fails once (pre-install), then verify passes post-install.
    let installed = false;
    const gated: RemoteExec = async (command, opts) => {
      if (command.includes("get.docker.com")) {
        installed = true;
        return exec(command, opts);
      }
      if (command.includes("docker info")) return { code: installed ? 0 : 1, lines: [] };
      return exec(command, opts);
    };
    await runBootstrap(buildBootstrapSteps(gated), log);
    expect(log).toHaveBeenCalledWith("# Executing docker install script");
  });
});
