// Local-socket-vs-SSH selection (09-multi-server.md; Dokploy remote-docker.ts
// pattern). A worker server is driven via DOCKER_HOST=ssh://, so dockerode and
// the compose CLI both target the remote daemon agentlessly.

export interface SshServer {
  host: string;
  sshUser: string;
  sshPort?: number;
  role?: string;
}

export function buildDockerHost(server: SshServer): string {
  const port = server.sshPort && server.sshPort !== 22 ? `:${server.sshPort}` : "";
  return `ssh://${server.sshUser}@${server.host}${port}`;
}

/** Stable key for the per-server connection pool (one ssh2 Client per server). */
export function poolKey(server: SshServer): string {
  return `${server.sshUser}@${server.host}:${server.sshPort ?? 22}`;
}

/** The control server runs Docker locally; workers are remote over SSH. */
export function isLocal(server: SshServer): boolean {
  return server.role === "control" || server.host === "127.0.0.1" || server.host === "localhost";
}
