// WebSocket helpers (12-realtime-logs.md). The control plane exposes one socket
// at /api/v1/ws; clients send {type:"subscribe", topic:"<kind>:<id>"} and receive
// JSON frames. parseWsFrame is pure + unit-tested.

export interface WsFrame {
  type: string;
  [key: string]: unknown;
}

export function wsUrl(path: string): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}${path}`;
}

export function parseWsFrame(data: string): WsFrame | null {
  try {
    const f: unknown = JSON.parse(data);
    return f !== null && typeof f === "object" && typeof (f as { type?: unknown }).type === "string"
      ? (f as WsFrame)
      : null;
  } catch {
    return null;
  }
}
