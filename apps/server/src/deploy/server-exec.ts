import type { SshTarget } from "../ssh/exec.js";
import type { SshPool } from "../ssh/pool.js";

import { type ExecTarget, chooseExecLocation, localTarget, remoteTarget } from "./exec-target.js";
import { makeRemoteExec } from "./exec.js";

// Seam last mile (R4.1): turn an app's `servers` row into a ready ExecTarget.
// Local server → localExec. Remote worker → a pool-backed SSH Exec, with the
// private key read from the secret store (sshRef) and folded into the shared
// connection target. Deps are injected so the secret-store + pool boundary stays
// testable; the executor passes the real `sshPool` + key reader.

export interface ServerRow {
  host: string;
  sshPort: number;
  sshUser: string;
  sshRef: string | null;
  role: string;
}

export interface RemoteExecDeps {
  /** sshRef → PEM private key (secret store, 11). Never logged. */
  readKey: (sshRef: string) => Promise<string>;
  pool: Pick<SshPool, "exec">;
  readyTimeoutMs?: number;
}

export async function resolveServerExecTarget(
  server: ServerRow | null | undefined,
  deps: RemoteExecDeps,
): Promise<ExecTarget> {
  if (chooseExecLocation(server ?? null) === "local") return localTarget();
  const s = server as ServerRow;
  const privateKey = s.sshRef ? await deps.readKey(s.sshRef) : "";
  const target: SshTarget = {
    host: s.host,
    port: s.sshPort,
    username: s.sshUser,
    privateKey,
    ...(deps.readyTimeoutMs ? { readyTimeoutMs: deps.readyTimeoutMs } : {}),
  };
  const exec = makeRemoteExec((command, opts) => deps.pool.exec(target, command, opts));
  return remoteTarget(s, exec);
}
