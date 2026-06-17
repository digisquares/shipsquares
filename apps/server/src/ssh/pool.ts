// ssh2 is CJS — destructure the default export so tsx's ESM loader resolves it.
import ssh2 from "ssh2";

import type { ExecResult } from "../deploy/exec.js";

const { Client: SshClient } = ssh2;

import { execOverClient, type ExecOpts, type SshTarget } from "./exec.js";

// SSH connection pool (09-multi-server.md): one live ssh2 connection per
// user@host:port, reused across execs (each exec is its own channel). A failed
// connect, a throwing channel, or a transport close evicts the entry so the
// next exec reconnects. The pooling logic is pure (injected connect) and
// unit-tested; `sshPool` is the runtime instance over ssh2.

export interface PooledClient {
  exec(command: string, opts?: ExecOpts): Promise<ExecResult>;
  end(): void;
  /** invoked when the underlying transport closes/errors (eviction hook) */
  onClosed(cb: () => void): void;
}

export type ConnectFn = (target: SshTarget) => Promise<PooledClient>;

export interface SshPool {
  exec(target: SshTarget, command: string, opts?: ExecOpts): Promise<ExecResult>;
  /** Drop (and close) the connection for one target so the next exec reconnects
   *  fresh — e.g. after bootstrap adds the user to the docker group, whose
   *  membership a NEW login session must pick up (09-multi-server.md). */
  evict(target: SshTarget): void;
  close(): Promise<void>;
  size(): number;
}

export function createSshPool(connect: ConnectFn): SshPool {
  const conns = new Map<string, Promise<PooledClient>>();
  const keyOf = (t: SshTarget): string => `${t.username}@${t.host}:${t.port ?? 22}`;

  async function exec(target: SshTarget, command: string, opts?: ExecOpts): Promise<ExecResult> {
    const key = keyOf(target);
    let entry = conns.get(key);
    if (!entry) {
      const pending = connect(target).then((client) => {
        client.onClosed(() => {
          if (conns.get(key) === pending) conns.delete(key);
        });
        return client;
      });
      pending.catch(() => {
        if (conns.get(key) === pending) conns.delete(key);
      });
      conns.set(key, pending);
      entry = pending;
    }
    const client = await entry;
    try {
      return await client.exec(command, opts);
    } catch (err) {
      // A throwing exec usually means a dead transport — evict + close it.
      if (conns.get(key) === entry) conns.delete(key);
      client.end();
      throw err;
    }
  }

  function evict(target: SshTarget): void {
    const key = keyOf(target);
    const entry = conns.get(key);
    if (!entry) return;
    conns.delete(key);
    entry.then((c) => c.end()).catch(() => undefined);
  }

  async function close(): Promise<void> {
    const all = [...conns.values()];
    conns.clear();
    await Promise.allSettled(
      all.map(async (p) => {
        (await p).end();
      }),
    );
  }

  return { exec, evict, close, size: () => conns.size };
}

/** Runtime connect: a persistent ssh2 Client; execs ride separate channels. */
function connectSsh(target: SshTarget): Promise<PooledClient> {
  return new Promise((resolve, reject) => {
    const conn = new SshClient();
    const closedCbs: Array<() => void> = [];
    let ready = false;
    conn.on("ready", () => {
      ready = true;
      resolve({
        exec: (command, opts) => execOverClient(conn, command, opts),
        end: () => conn.end(),
        onClosed: (cb) => closedCbs.push(cb),
      });
    });
    conn.on("error", (err: Error & { level?: string }) => {
      if (!ready) {
        reject(
          err.level === "client-authentication"
            ? new Error(`SSH authentication to ${target.host} failed — check the server's key`)
            : err,
        );
      }
      for (const cb of closedCbs) cb();
    });
    conn.on("close", () => {
      for (const cb of closedCbs) cb();
    });
    conn.connect({
      host: target.host,
      port: target.port ?? 22,
      username: target.username,
      privateKey: target.privateKey,
      readyTimeout: target.readyTimeoutMs ?? 10_000,
    });
  });
}

/** The process-wide pool every remote caller shares. */
export const sshPool: SshPool = createSshPool(connectSsh);
