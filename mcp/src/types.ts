// Minimal shapes of the control-plane responses the MCP tools surface. Mirrors
// the server's REST API (04-api-openapi.md), kept small + hand-written.

export interface App {
  id: string;
  name: string;
  repo: string | null;
  image: string | null;
  branch: string;
  port: number;
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
