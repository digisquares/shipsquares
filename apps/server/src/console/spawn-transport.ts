import { spawn } from "node:child_process";

import type { PtyFactory, PtyLike } from "./terminal.js";

// Pipe-based console transport (21-logs-and-console.md): `docker exec -i`
// over plain stdio. No TTY semantics (resize is a no-op, no readline editing)
// but zero native deps — node-pty slots in behind the same PtyLike seam on
// VMs where the native build is available. Target/shell are pre-validated by
// the protocol parser; args go straight to spawn (no shell interpolation).

export const dockerExecTransport: PtyFactory = (spec): PtyLike => {
  const child = spawn(spec.command, spec.args, { stdio: ["pipe", "pipe", "pipe"] });
  return {
    write: (data) => child.stdin.write(data),
    resize: () => undefined, // pipes have no winsize
    kill: () => child.kill("SIGKILL"),
    onData: (cb) => {
      child.stdout.on("data", (d: Buffer) => cb(d.toString("utf8")));
      child.stderr.on("data", (d: Buffer) => cb(d.toString("utf8")));
    },
    onExit: (cb) => {
      child.on("close", (code) => cb(code ?? -1));
      child.on("error", () => cb(-1));
    },
  };
};

export function execSpawnSpec(target: string, shell: string): { command: string; args: string[] } {
  return { command: "docker", args: ["exec", "-i", target, shell] };
}
