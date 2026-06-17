import { randomUUID } from "node:crypto";

import postgres from "postgres";

import { logBus, type LogFrame } from "./bus.js";

// Cross-process realtime bridge (ROADMAP R2.4): the in-process bus stays the
// interface; this mirrors every published frame over pg NOTIFY and re-emits
// frames that OTHER processes published — multi-instance control planes fan
// out logs/status without Redis. Self-originated messages are filtered by a
// per-process origin id, so the single-process case is a no-op loop-wise.

const CHANNEL = "ss_bus";
const MAX_PAYLOAD = 7800; // NOTIFY caps at 8000 bytes — leave envelope room
const TRUNCATED = "…";

export type BusEvent =
  | { kind: "log"; deploymentId: string; frame: LogFrame }
  | { kind: "status"; deploymentId: string; status: string };

export function encodeBusEvent(event: BusEvent, origin: string): string {
  let payload = JSON.stringify({ origin, ...event });
  if (payload.length > MAX_PAYLOAD && event.kind === "log") {
    const overshoot = payload.length - MAX_PAYLOAD;
    const line = event.frame.line;
    const trimmed = `${line.slice(0, Math.max(0, line.length - overshoot - TRUNCATED.length))}${TRUNCATED}`;
    payload = JSON.stringify({ origin, ...event, frame: { ...event.frame, line: trimmed } });
  }
  return payload;
}

export function decodeBusEvent(payload: string, selfOrigin: string): BusEvent | null {
  try {
    const parsed = JSON.parse(payload) as { origin?: string; kind?: string } & Record<
      string,
      unknown
    >;
    if (!parsed.origin || parsed.origin === selfOrigin) return null;
    if (parsed.kind === "log" && parsed.deploymentId && parsed.frame) {
      return {
        kind: "log",
        deploymentId: parsed.deploymentId as string,
        frame: parsed.frame as LogFrame,
      };
    }
    if (parsed.kind === "status" && parsed.deploymentId && parsed.status) {
      return {
        kind: "status",
        deploymentId: parsed.deploymentId as string,
        status: parsed.status as string,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** Wire the bus to Postgres: forward local publishes via NOTIFY, re-emit
 *  remote ones locally. Uses a dedicated single connection for LISTEN. */
export async function startPgBridge(databaseUrl: string): Promise<() => Promise<void>> {
  const origin = randomUUID();
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined });

  logBus.setForwarder((event) => {
    const payload = encodeBusEvent(event, origin);
    void sql`select pg_notify(${CHANNEL}, ${payload})`.catch(() => undefined);
  });

  await sql.listen(CHANNEL, (payload) => {
    const event = decodeBusEvent(payload, origin);
    if (!event) return;
    if (event.kind === "log") logBus.injectRemote(event.deploymentId, event.frame);
    else logBus.injectRemoteStatus(event.deploymentId, event.status);
  });

  return async () => {
    logBus.setForwarder(null);
    await sql.end({ timeout: 2 });
  };
}
