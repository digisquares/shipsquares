import type { PtyFactory, PtyLike } from "./terminal.js";

// True-TTY console transport (21 / ROADMAP): node-pty gives the host side a
// real pseudo-terminal, so `docker exec -it` allocates a TTY in the container
// — readline editing, vim/top, colour, resize all work, unlike the pipe
// transport. node-pty is an OPTIONAL native dep: the route loads it when the
// build is present and falls back to the pipe transport otherwise, so the
// control plane still installs everywhere. The module is injected here, so
// this maps cleanly to PtyLike and is unit-tested without the native build.

export interface IPtyLike {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  onData(cb: (data: string) => void): void;
  onExit(cb: (e: { exitCode: number }) => void): void;
}

export interface NodePtyModule {
  spawn(
    file: string,
    args: string[],
    opts: { name: string; cols: number; rows: number; cwd?: string; env?: NodeJS.ProcessEnv },
  ): IPtyLike;
}

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

/** A PtyFactory backed by node-pty (module injected for testability). */
export function makePtyTransport(pty: NodePtyModule): PtyFactory {
  return (spec): PtyLike => {
    const term = pty.spawn(spec.command, spec.args, {
      name: "xterm-color",
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
      ...(spec.cwd ? { cwd: spec.cwd } : {}),
    });
    return {
      write: (data) => term.write(data),
      resize: (cols, rows) => term.resize(cols, rows),
      kill: () => term.kill(),
      onData: (cb) => term.onData((d) => cb(d)),
      onExit: (cb) => term.onExit(({ exitCode }) => cb(exitCode)),
    };
  };
}

/** `docker exec -it` — the `-t` allocates the in-container TTY (the host TTY
 *  is node-pty's). Target/shell are pre-validated by the protocol parser. */
export function execPtySpec(target: string, shell: string): { command: string; args: string[] } {
  return { command: "docker", args: ["exec", "-it", target, shell] };
}

/** Try to load node-pty; null when the optional native build isn't present. */
export async function loadNodePty(): Promise<NodePtyModule | null> {
  try {
    const mod = (await import("node-pty")) as unknown as NodePtyModule;
    return typeof mod.spawn === "function" ? mod : null;
  } catch {
    return null;
  }
}
