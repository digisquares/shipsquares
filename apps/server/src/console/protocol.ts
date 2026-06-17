import { isValidContainerTarget, isValidShell } from "./validators.js";

// Console WS message protocol (21-logs-and-console.md): every client frame is
// validated before it can reach a shell or docker argv — the validators are
// the security boundary, this is the parser over them.

export type ConsoleFrame =
  | { type: "open"; target: string; shell: string }
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number };

const MAX_INPUT = 64 * 1024;
const MAX_DIMENSION = 500;

const dim = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= MAX_DIMENSION;

export function parseConsoleFrame(raw: string): ConsoleFrame | null {
  let msg: unknown;
  try {
    msg = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof msg !== "object" || msg === null) return null;
  const m = msg as Record<string, unknown>;

  if (m.type === "open") {
    if (typeof m.target !== "string" || !isValidContainerTarget(m.target)) return null;
    if (typeof m.shell !== "string" || !isValidShell(m.shell)) return null;
    return { type: "open", target: m.target, shell: m.shell };
  }
  if (m.type === "input") {
    if (typeof m.data !== "string" || m.data.length > MAX_INPUT) return null;
    return { type: "input", data: m.data };
  }
  if (m.type === "resize") {
    if (!dim(m.cols) || !dim(m.rows)) return null;
    return { type: "resize", cols: m.cols, rows: m.rows };
  }
  return null;
}
