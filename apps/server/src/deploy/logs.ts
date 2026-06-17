import { spawn } from "node:child_process";

import { firstStdout, runCommand } from "./exec.js";

// Runtime container logs (12-realtime-logs.md / 21-logs-and-console.md): the
// stdout/stderr of an app's RUNNING container, as opposed to the build/deploy
// logs persisted per deployment. These are read straight from `docker logs` —
// ephemeral, not stored — so a tail is a point-in-time snapshot and the live
// stream is a `docker logs -f` child piped to a WebSocket, killed on unsubscribe.

export interface RuntimeLogLine {
  stream: "stdout" | "stderr";
  line: string;
  ts?: string; // RFC3339 from `docker logs --timestamps`, when present
}

/** The app's running container id (by label), or "" if none is running. */
async function runningContainer(appId: string): Promise<string> {
  return firstStdout(
    await runCommand("docker", ["ps", "-q", "--filter", `label=shipsquares.app=${appId}`]),
  );
}

/** Split docker's `--timestamps` prefix off a line: "2024-… <message>". */
function parseLine(stream: "stdout" | "stderr", raw: string): RuntimeLogLine {
  const sp = raw.indexOf(" ");
  if (sp > 0) {
    const head = raw.slice(0, sp);
    // a docker timestamp is an RFC3339 instant (has a 'T' and ends in 'Z'/offset)
    if (head.includes("T") && /\d{4}-\d{2}-\d{2}T/.test(head)) {
      return { stream, line: raw.slice(sp + 1), ts: head };
    }
  }
  return { stream, line: raw };
}

/** A point-in-time tail of the app's container stdout/stderr (REST snapshot).
 *  Empty when no container is running. */
export async function tailLogs(appId: string, tail = 200): Promise<RuntimeLogLine[]> {
  const cid = await runningContainer(appId);
  if (!cid) return [];
  const res = await runCommand("docker", ["logs", "--tail", String(tail), "--timestamps", cid]);
  return res.lines.map((l) => parseLine(l.stream, l.line));
}

export interface LogStreamHandle {
  stop: () => void;
}

/** Live-tail an app's running container: spawn `docker logs -f` and pipe each
 *  line to `onLine`. Returns a handle whose `stop()` kills the child (call it on
 *  unsubscribe / socket close), or null when no container is running. `onEnd`
 *  fires when the stream closes on its own (e.g. the container stops/restarts). */
export async function streamLogs(
  appId: string,
  onLine: (l: RuntimeLogLine) => void,
  opts: { tail?: number; onEnd?: () => void } = {},
): Promise<LogStreamHandle | null> {
  const cid = await runningContainer(appId);
  if (!cid) return null;
  const child = spawn("docker", [
    "logs",
    "-f",
    "--tail",
    String(opts.tail ?? 200),
    "--timestamps",
    cid,
  ]);
  const reader = (stream: "stdout" | "stderr") => {
    let buf = "";
    return (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      let idx: number;
      while ((idx = buf.indexOf("\n")) >= 0) {
        onLine(parseLine(stream, buf.slice(0, idx)));
        buf = buf.slice(idx + 1);
      }
    };
  };
  child.stdout.on("data", reader("stdout"));
  child.stderr.on("data", reader("stderr"));
  child.on("error", () => opts.onEnd?.());
  child.on("close", () => opts.onEnd?.());
  return {
    stop: () => {
      child.stdout.removeAllListeners();
      child.stderr.removeAllListeners();
      child.removeAllListeners("close");
      child.kill("SIGKILL");
    },
  };
}
