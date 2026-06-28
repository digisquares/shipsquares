// Per-test unique suffix so parallel workers / reruns never collide on names.
// Deterministic-ish from time + a counter; good enough for entity-name isolation.
let counter = 0;
export function runId(): string {
  counter += 1;
  return `${Date.now().toString(36)}-${counter}`;
}
