// ssh2 is CJS — destructure the default export so tsx's ESM loader resolves it.
import ssh2 from "ssh2";
import type { Client } from "ssh2";

import { type ExecLine, type ExecResult } from "../deploy/exec.js";

const { Client: SshClient } = ssh2;

// Remote command execution over SSH (09-multi-server.md), adapted from
// Dokploy's utils/process/execAsync.ts (Apache-2.0, see NOTICE): stdout/stderr
// streamed line-by-line in the same ExecResult shape as the local runCommand
// so deploy steps are transport-agnostic. Key-only auth; never logs private
// material. `execOverClient` runs one channel on a caller-owned connection
// (the pool reuses it); `runRemoteCommand` is the one-shot form.

export interface SshTarget {
  host: string;
  port?: number;
  username: string;
  /** PEM private key (from the secret store — never logged) */
  privateKey: string;
  /** connection handshake timeout */
  readyTimeoutMs?: number;
}

export interface ExecOpts {
  onLine?: (stream: "stdout" | "stderr", line: string) => void;
  timeoutMs?: number;
}

/** Run one command as a channel on an already-connected Client. The
 *  connection stays open — the caller owns its lifecycle. */
export function execOverClient(
  conn: Client,
  command: string,
  opts: ExecOpts = {},
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const lines: ExecLine[] = [];
    let timedOut = false;
    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    const emit = (stream: "stdout" | "stderr", line: string): void => {
      lines.push({ stream, line });
      opts.onLine?.(stream, line);
    };
    const makeReader = (stream: "stdout" | "stderr") => {
      let buf = "";
      return {
        onData(chunk: Buffer): void {
          buf += chunk.toString("utf8");
          let idx: number;
          while ((idx = buf.indexOf("\n")) >= 0) {
            emit(stream, buf.slice(0, idx));
            buf = buf.slice(idx + 1);
          }
        },
        flush(): void {
          if (buf.length > 0) {
            emit(stream, buf);
            buf = "";
          }
        },
      };
    };

    conn.exec(command, (err, stream) => {
      if (err) {
        if (!settled) {
          settled = true;
          reject(err);
        }
        return;
      }
      const out = makeReader("stdout");
      const errR = makeReader("stderr");
      if (opts.timeoutMs && opts.timeoutMs > 0) {
        timer = setTimeout(() => {
          timedOut = true;
          emit("stderr", `timed out after ${Math.round(opts.timeoutMs! / 1000)}s — closing`);
          stream.close();
        }, opts.timeoutMs);
      }
      stream.on("data", (c: Buffer) => out.onData(c));
      stream.stderr.on("data", (c: Buffer) => errR.onData(c));
      stream.on("close", (code: number | null) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        out.flush();
        errR.flush();
        resolve({
          code: timedOut ? -1 : (code ?? -1),
          lines,
          ...(timedOut ? { timedOut } : {}),
        });
      });
    });
  });
}

/** One connection per command (the original Dokploy shape). Prefer the pool
 *  (`ssh/pool.ts`) for anything called repeatedly. */
export function runRemoteCommand(
  target: SshTarget,
  command: string,
  opts: ExecOpts = {},
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const conn = new SshClient();
    let settled = false;

    conn.on("ready", () => {
      execOverClient(conn, command, opts)
        .then((res) => {
          if (!settled) {
            settled = true;
            resolve(res);
          }
        })
        .catch((err: unknown) => {
          if (!settled) {
            settled = true;
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        })
        .finally(() => conn.end());
    });
    conn.on("error", (err: Error & { level?: string }) => {
      if (settled) return;
      settled = true;
      conn.end();
      // Friendly auth message (Dokploy's UX touch) without leaking key material.
      reject(
        err.level === "client-authentication"
          ? new Error(`SSH authentication to ${target.host} failed — check the server's key`)
          : err,
      );
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
