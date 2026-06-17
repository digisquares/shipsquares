import { LimitQueue } from "./limit-queue.js";

// Terminal registry (21-logs-and-console.md), adapted from dockge's
// backend/terminal.ts (MIT, see NOTICE): one named terminal per target, a
// bounded scrollback buffer replayed to late joiners, and multi-client
// broadcast. The pty transport is INJECTED (node-pty locally, ssh2 pty
// remotely) so this whole layer is unit-testable without a native dep; the WS
// route wires clients to it.

export interface PtyLike {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(cb: (chunk: string) => void): void;
  onExit(cb: (code: number) => void): void;
}

export interface SpawnSpec {
  command: string;
  args: string[];
  cwd?: string;
}

export type PtyFactory = (spec: SpawnSpec) => PtyLike;

interface Client {
  onData: (chunk: string) => void;
  onExit?: (code: number) => void;
}

export interface Terminal {
  readonly name: string;
  join(clientId: string, onData: (chunk: string) => void, onExit?: (code: number) => void): void;
  leave(clientId: string): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  clientCount(): number;
}

export interface TerminalRegistry {
  /** Get-or-create: a second open() for the same name joins the live terminal. */
  open(name: string, spec: SpawnSpec): Terminal;
  get(name: string): Terminal | undefined;
}

export function createTerminalRegistry(deps: {
  spawn: PtyFactory;
  /** scrollback chunks replayed to late joiners */
  scrollback: number;
}): TerminalRegistry {
  const terminals = new Map<string, Terminal>();

  function create(name: string, spec: SpawnSpec): Terminal {
    const pty = deps.spawn(spec);
    const buffer = new LimitQueue<string>(deps.scrollback);
    const clients = new Map<string, Client>();

    pty.onData((chunk) => {
      buffer.push(chunk);
      for (const c of clients.values()) c.onData(chunk);
    });
    pty.onExit((code) => {
      for (const c of clients.values()) c.onExit?.(code);
      clients.clear();
      terminals.delete(name);
    });

    const terminal: Terminal = {
      name,
      join(clientId, onData, onExit) {
        clients.set(clientId, { onData, ...(onExit ? { onExit } : {}) });
        for (const chunk of buffer.toArray()) onData(chunk); // replay the tail
      },
      leave(clientId) {
        clients.delete(clientId);
      },
      write: (data) => pty.write(data),
      resize: (cols, rows) => pty.resize(cols, rows),
      kill: () => pty.kill(),
      clientCount: () => clients.size,
    };
    return terminal;
  }

  return {
    open(name, spec) {
      const existing = terminals.get(name);
      if (existing) return existing;
      const t = create(name, spec);
      terminals.set(name, t);
      return t;
    },
    get: (name) => terminals.get(name),
  };
}

/** Canonical terminal names (dockge convention) — one shared session per target. */
export function containerExecTerminalName(appId: string): string {
  return `exec:${appId}`;
}
export function deployLogsTerminalName(deploymentId: string): string {
  return `deploy:${deploymentId}`;
}
