// Server lifecycle state machine (09-multi-server.md). A server moves
// adding → bootstrapping → ready, and can later go unreachable/error and recover.

export type ServerStatus = "adding" | "bootstrapping" | "ready" | "error" | "unreachable";

const TRANSITIONS: Record<ServerStatus, readonly ServerStatus[]> = {
  adding: ["bootstrapping", "error"],
  bootstrapping: ["ready", "error"],
  ready: ["unreachable", "bootstrapping", "error"],
  unreachable: ["ready", "error", "bootstrapping"],
  error: ["adding", "bootstrapping"],
};

export function canTransition(from: ServerStatus, to: ServerStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: ServerStatus, to: ServerStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`invalid server status transition: ${from} -> ${to}`);
  }
}
