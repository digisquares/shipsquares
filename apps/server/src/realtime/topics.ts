// Typed, org-scoped WebSocket topics (12-realtime-logs.md). The client subscribes
// to a topic string; the server authorizes it against the caller's memberships
// (the client never names an org it isn't in — server-side scoping only).

export type TopicKind = "deployment" | "app" | "org";

export interface Topic {
  kind: TopicKind;
  id: string;
}

export const deploymentTopic = (id: string): string => `deployment:${id}`;
export const appTopic = (id: string): string => `app:${id}`;
export const orgTopic = (id: string): string => `org:${id}`;

export function parseTopic(raw: string): Topic | null {
  const sep = raw.indexOf(":");
  if (sep < 0) return null;
  const kind = raw.slice(0, sep);
  const id = raw.slice(sep + 1);
  if (!id) return null;
  if (kind === "deployment" || kind === "app" || kind === "org") return { kind, id };
  return null;
}
