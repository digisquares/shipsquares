// Docker access layer types (07-docker-builders.md). One DockerHandle drives both
// dockerode (Engine API) and the `docker compose` CLI against a local socket or a
// remote SSH target, so callers never care where the daemon is.

export type DockerTarget =
  | { kind: "local"; socketPath: string } // unix:// or npipe://
  | { kind: "ssh"; host: string; user: string; keyRef: string }; // DOCKER_HOST=ssh://

export interface ExecResult {
  exitCode: number;
}

export interface ExecOpts {
  cwd?: string;
  env?: Record<string, string>; // resolved secrets (11) — never logged
  onLine?: (line: string, stream: "stdout" | "stderr") => void;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface DockerHandle {
  /** dockerode.Docker in the runtime impl (docker/handle.ts). */
  readonly api: unknown;
  readonly target: DockerTarget;
  compose(args: string[], opts?: ExecOpts): Promise<ExecResult>;
  exec(file: string, args: string[], opts?: ExecOpts): Promise<ExecResult>;
}
