import { spawn } from "node:child_process";

// Run an external command (git/docker), capturing stdout/stderr line-by-line so
// each line can be streamed to deployment_logs (06-deploy-engine.md). Args are
// passed as an array (no shell), so app/repo values can't inject commands.
// `timeoutMs` SIGKILLs a hung child — a stuck git/docker must not leave
// a deployment `running` forever. No default: streaming callers (docker logs -f)
// must opt in per call.
export interface ExecLine {
  stream: "stdout" | "stderr";
  line: string;
}
export interface ExecResult {
  code: number;
  lines: ExecLine[];
  timedOut?: boolean;
  aborted?: boolean;
}

export function runCommand(
  cmd: string,
  args: string[],
  opts: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    onLine?: (stream: "stdout" | "stderr", line: string) => void;
    timeoutMs?: number;
    /** Cooperative cancellation: aborting SIGKILLs the child (deploy cancel). */
    signal?: AbortSignal;
  } = {},
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    // Already-cancelled: don't even spawn.
    if (opts.signal?.aborted) {
      resolve({ code: -1, lines: [{ stream: "stderr", line: "cancelled" }], aborted: true });
      return;
    }
    const child = spawn(cmd, args, {
      ...(opts.cwd ? { cwd: opts.cwd } : {}),
      env: opts.env ?? process.env,
    });
    const lines: ExecLine[] = [];
    let timedOut = false;
    let aborted = false;

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
            const line = buf.slice(0, idx);
            buf = buf.slice(idx + 1);
            emit(stream, line);
          }
        },
        // The final unterminated line is often the actual error — keep it.
        flush(): void {
          if (buf.length > 0) {
            emit(stream, buf);
            buf = "";
          }
        },
      };
    };
    const out = makeReader("stdout");
    const err = makeReader("stderr");
    child.stdout.on("data", (c: Buffer) => out.onData(c));
    child.stderr.on("data", (c: Buffer) => err.onData(c));

    let timer: NodeJS.Timeout | undefined;
    const timeoutMs = opts.timeoutMs;
    if (timeoutMs && timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        emit("stderr", `timed out after ${Math.round(timeoutMs / 1000)}s — killing ${cmd}`);
        child.kill("SIGKILL");
      }, timeoutMs);
    }

    const onAbort = (): void => {
      aborted = true;
      emit("stderr", `cancelled — killing ${cmd}`);
      child.kill("SIGKILL");
    };
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    child.on("error", (e) => {
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      reject(e);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      out.flush();
      err.flush();
      resolve({
        code: timedOut || aborted ? -1 : (code ?? -1),
        lines,
        ...(timedOut ? { timedOut } : {}),
        ...(aborted ? { aborted } : {}),
      });
    });
  });
}

/** First stdout line, trimmed (e.g. a commit SHA or a `docker port` mapping). */
export function firstStdout(result: ExecResult): string {
  return result.lines.find((l) => l.stream === "stdout")?.line.trim() ?? "";
}

// ── Transport seam (09-multi-server.md / R4.1) ──────────────────────────────
// The deploy steps run external commands through an `Exec`. Locally that's
// `runCommand` (array args, no shell). For a remote worker the SAME steps run
// over SSH (ssh/exec.ts) against the server's docker daemon — agentless. A
// remote shell needs ONE command string, so cmd+args+cwd+env are composed into
// a POSIX line with every field shell-quoted (the array-args injection guard
// the local path gets for free). The two impls share `ExecResult`, so the
// executor is transport-agnostic.

export interface ExecOptions {
  cwd?: string;
  /** EXTRA env to set for this command (a delta, not the whole environment):
   *  local merges it over process.env; remote prefixes it as `VAR=val …`. */
  env?: Record<string, string | undefined>;
  onLine?: (stream: "stdout" | "stderr", line: string) => void;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export type Exec = (cmd: string, args: string[], opts?: ExecOptions) => Promise<ExecResult>;

/** POSIX single-quote quoting: wrap in '…', and close/escape/reopen embedded
 *  quotes (`'` → `'\''`). Safe for arbitrary app/repo/token values in a shell. */
export function shellQuote(arg: string): string {
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

/** Compose one remote shell line: `cd <cwd> && VAR=val … cmd arg …`, every
 *  field quoted. Pure — the bug-prone part, unit-tested independently. */
export function composeRemoteCommand(cmd: string, args: string[], opts: ExecOptions = {}): string {
  const envPrefix = Object.entries(opts.env ?? {})
    .filter((e): e is [string, string] => e[1] != null)
    .map(([k, v]) => `${k}=${shellQuote(v)}`)
    .join(" ");
  const command = [cmd, ...args].map(shellQuote).join(" ");
  const withEnv = envPrefix ? `${envPrefix} ${command}` : command;
  return opts.cwd ? `cd ${shellQuote(opts.cwd)} && ${withEnv}` : withEnv;
}

/** Local transport. `env` is a DELTA (see ExecOptions): merge it over
 *  process.env so PATH etc. survive, matching how the remote path treats env as
 *  additive prefixes. */
export const localExec: Exec = (cmd, args, opts = {}) =>
  runCommand(cmd, args, {
    ...opts,
    ...(opts.env ? { env: { ...process.env, ...opts.env } } : {}),
  });

/** Remote transport: fold the command into a shell line and hand it to a runner
 *  bound to an SSH connection (ssh/exec.ts `execOverClient`). cwd/env travel in
 *  the composed line; onLine/timeout pass through. (Cancellation over SSH is a
 *  follow-up — the runner closes the channel on the executor's signal.) */
export function makeRemoteExec(
  run: (
    command: string,
    opts: { onLine?: (stream: "stdout" | "stderr", line: string) => void; timeoutMs?: number },
  ) => Promise<ExecResult>,
): Exec {
  return (cmd, args, opts = {}) =>
    run(composeRemoteCommand(cmd, args, opts), {
      ...(opts.onLine ? { onLine: opts.onLine } : {}),
      ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
    });
}
