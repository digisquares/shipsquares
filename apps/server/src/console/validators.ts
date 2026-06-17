// Console input validators (21-logs-and-console.md), ported from dokploy's
// wss/utils.ts (MIT, see NOTICE). Security-load-bearing: every WS-supplied
// value that reaches a shell or docker argv must pass one of these first.

const CONTAINER_TARGET = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const SHELLS = new Set(["sh", "bash", "/bin/sh", "/bin/bash"]);
const MAX_TAIL = 10_000;

/** Docker container name/id charset only — no spaces, quotes, or metacharacters. */
export function isValidContainerTarget(value: string): boolean {
  return value.length > 0 && value.length <= 255 && CONTAINER_TARGET.test(value);
}

export function isValidShell(value: string): boolean {
  return SHELLS.has(value);
}

export function isValidTail(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= MAX_TAIL;
}
