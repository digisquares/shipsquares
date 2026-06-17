// Minimal shapes of the control-plane responses the CLI consumes. These mirror
// the server's API (04-api-openapi.md); the typed openapi-client is the richer
// option, but the CLI keeps a tiny hand-written subset to stay dependency-free.

export interface App {
  id: string;
  name: string;
  repo: string | null;
  image: string | null;
  branch: string;
}

export interface Deployment {
  id: string;
  status: string;
  trigger: string;
  commitAfter: string | null;
  queuedAt: string;
}

export interface Metrics {
  running: boolean;
  cpuPercent?: number;
  memPercent?: number;
  memUsage?: string;
}

export interface RuntimeLogLine {
  stream: string;
  line: string;
  ts?: string;
}

export interface Page<T> {
  data: T[];
}
