import type { ExecResult } from "../deploy/exec.js";

import type { BootstrapStep } from "./bootstrap.js";

// The concrete agentless bootstrap steps (09-multi-server.md): probe-then-act
// over an injected remote exec, so the composition is unit-tested without a
// VM. Docker installs via get.docker.com (Coolify's installer path), which
// ships the compose plugin on apt/rpm distros — the compose step exists for
// hosts where it didn't. Per-server Caddy arrives with remote converge.

export type RemoteExec = (
  command: string,
  opts?: {
    onLine?: (stream: "stdout" | "stderr", line: string) => void;
    timeoutMs?: number;
  },
) => Promise<ExecResult>;

const PROBE_TIMEOUT_MS = 30_000;
const INSTALL_TIMEOUT_MS = 10 * 60_000;

export function buildBootstrapSteps(exec: RemoteExec): BootstrapStep[] {
  const ok = async (command: string): Promise<boolean> =>
    (await exec(command, { timeoutMs: PROBE_TIMEOUT_MS })).code === 0;

  // Agentless: the SSH user is a non-root sudoer (the cloud-VM norm), so
  // privileged commands run via passwordless sudo. Installing docker also adds
  // the user to the `docker` group so DEPLOYS (which run `docker` as the user,
  // no sudo, to keep `-e KEY` env passthrough working) can reach the socket in a
  // fresh session. Verification uses `sudo docker …` (group membership isn't
  // visible in the install session). get.docker.com self-installs the compose
  // plugin on apt/rpm; the compose step covers hosts where it didn't.
  return [
    {
      id: "docker",
      probe: () => ok("sudo docker info --format '{{.ServerVersion}}'"),
      async apply(log) {
        const res = await exec(
          'curl -fsSL https://get.docker.com | sudo sh && sudo usermod -aG docker "$(id -un)"',
          { onLine: (_stream, line) => log(line), timeoutMs: INSTALL_TIMEOUT_MS },
        );
        if (res.code !== 0) {
          throw new Error(
            `docker install failed (exit ${res.code}${res.timedOut ? ", timed out" : ""})`,
          );
        }
      },
      verify: () => ok("sudo docker info --format '{{.ServerVersion}}'"),
    },
    {
      id: "compose",
      probe: () => ok("sudo docker compose version"),
      async apply(log) {
        const res = await exec(
          "sudo apt-get update -qq && sudo apt-get install -y -qq docker-compose-plugin",
          { onLine: (_stream, line) => log(line), timeoutMs: INSTALL_TIMEOUT_MS },
        );
        if (res.code !== 0) {
          throw new Error(`compose plugin install failed (exit ${res.code})`);
        }
      },
      verify: () => ok("sudo docker compose version"),
    },
  ];
}
