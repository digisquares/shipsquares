import { isLocal, type SshServer } from "../ssh/docker-host.js";

import { type Exec, localExec } from "./exec.js";

// Where a deploy runs (09-multi-server / R4.1). An app's serverId selects the
// worker; a null server (or the control server / localhost) runs locally. The
// target bundles the Exec with the host the published container port is
// reachable on — health-probing and the Caddy upstream must use it (127.0.0.1
// locally; the server's host remotely, since the control plane can't reach a
// worker's loopback).

export interface ExecTarget {
  exec: Exec;
  /** reachable host for the health probe + proxy upstream */
  host: string;
  remote: boolean;
}

export function chooseExecLocation(server: SshServer | null | undefined): "local" | "remote" {
  if (!server) return "local";
  return isLocal(server) ? "local" : "remote";
}

export function localTarget(): ExecTarget {
  return { exec: localExec, host: "127.0.0.1", remote: false };
}

/** Remote target: the caller supplies an Exec already bound to the server's SSH
 *  connection (e.g. makeRemoteExec over the pool). Host = the server's address. */
export function remoteTarget(server: SshServer, exec: Exec): ExecTarget {
  return { exec, host: server.host, remote: true };
}

/** Resolve the target for a server row, given a factory that builds a remote
 *  Exec for a server. The factory is injected so the SSH-pool / secret-store
 *  boundary stays out of this pure selection (and out of its tests). */
export function resolveExecTarget(
  server: SshServer | null | undefined,
  makeRemote: (server: SshServer) => Exec,
): ExecTarget {
  if (chooseExecLocation(server) === "local") return localTarget();
  const s = server as SshServer;
  return remoteTarget(s, makeRemote(s));
}
