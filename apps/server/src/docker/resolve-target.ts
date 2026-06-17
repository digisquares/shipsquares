import type { DockerTarget } from "./types.js";

// Socket detection (port of Portainer api/docker/client CreateClient): a
// unix://|npipe:// host is a local dockerode client; ssh://|tcp:// is remote and
// driven by DOCKER_HOST=ssh:// so dockerode + the compose CLI both target it.

export interface ServerTarget {
  host: string;
  sshUser: string;
  sshKeyRef: string;
  dockerHost?: string | null; // unix:// | npipe:// | ssh:// | tcp://
}

export function defaultLocalHost(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? "npipe:////./pipe/docker_engine" : "unix:///var/run/docker.sock";
}

export function resolveTarget(
  server: ServerTarget,
  platform: NodeJS.Platform = process.platform,
): DockerTarget {
  const host = server.dockerHost ?? defaultLocalHost(platform);
  if (host.startsWith("unix://")) {
    return { kind: "local", socketPath: host.slice("unix://".length) };
  }
  if (host.startsWith("npipe://")) {
    return { kind: "local", socketPath: host.slice("npipe://".length) };
  }
  // ssh:// (agentless) or tcp:// — remote daemon over DOCKER_HOST.
  return { kind: "ssh", host: server.host, user: server.sshUser, keyRef: server.sshKeyRef };
}
