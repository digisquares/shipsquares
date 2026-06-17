import type { FastifyPluginAsync } from "fastify";

import { streamLogs } from "../deploy/logs.js";
import { checkPermission } from "../rbac/require-permission.js";
import { logBus, type LogFrame } from "../realtime/bus.js";
import { parseTopic } from "../realtime/topics.js";
import * as appsService from "../services/apps.service.js";
import * as deploymentsService from "../services/deployments.service.js";

// WebSocket live logs (12-realtime-logs.md). One connection; the client sends
// `{type:"subscribe", topic:"<kind>:<id>"}`:
//   • `deployment:<id>` → `subscribed` → `replay` (the persisted tail) → live
//     `log` frames + `deployment` status frames (build/deploy logs).
//   • `app:<id>` → `subscribed` → live `log` frames straight from the RUNNING
//     container (`docker logs -f`), then `ended` when the stream closes.
// Auth is the session resolved by the onRequest hook (`req.ctx`), scoped to org.
interface ClientMessage {
  type?: string;
  topic?: string;
}

export const wsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/ws", { websocket: true }, (socket, req) => {
    const send = (msg: unknown) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
    };
    send({ type: "ready", serverTime: new Date().toISOString() });
    const subs = new Map<string, () => void>(); // topic -> unsubscribe

    // app:<id> → live stdout/stderr of the app's RUNNING container. No replay/seq
    // (runtime logs are ephemeral); a `docker logs -f` child is piped to the
    // socket and killed on unsubscribe/close.
    const subscribeAppLogs = async (topicRaw: string, appId: string): Promise<void> => {
      const ctx = req.ctx;
      const perm = checkPermission(ctx, "app:read");
      if (!perm.ok || !ctx?.organizationId) {
        send({
          type: "error",
          topic: topicRaw,
          code: perm.ok ? "auth.unauthenticated" : perm.code,
        });
        return;
      }
      try {
        await appsService.getApp(app.db, ctx.organizationId, appId); // 404 if cross-tenant
      } catch {
        send({ type: "error", topic: topicRaw, code: "not_found" });
        return;
      }
      const handle = await streamLogs(
        appId,
        (line) => send({ type: "log", topic: topicRaw, line }),
        { onEnd: () => send({ type: "ended", topic: topicRaw }) },
      );
      if (!handle) {
        send({
          type: "error",
          topic: topicRaw,
          code: "not_running",
          message: "no running container",
        });
        return;
      }
      // the socket may have closed during the awaits — don't leak the child
      if (socket.readyState !== socket.OPEN) {
        handle.stop();
        return;
      }
      if (subs.has(topicRaw)) {
        // a concurrent subscribe won the race during the awaits — don't leak
        handle.stop();
        return;
      }
      subs.set(topicRaw, () => handle.stop());
      send({ type: "subscribed", topic: topicRaw });
    };

    const subscribe = async (topicRaw: string): Promise<void> => {
      if (subs.has(topicRaw)) return;
      const topic = parseTopic(topicRaw);
      if (!topic || (topic.kind !== "deployment" && topic.kind !== "app")) {
        send({
          type: "error",
          topic: topicRaw,
          code: "bad_topic",
          message: "only deployment:<id> or app:<id>",
        });
        return;
      }
      if (topic.kind === "app") return subscribeAppLogs(topicRaw, topic.id);
      const ctx = req.ctx;
      const perm = checkPermission(ctx, "deployment:read");
      if (!perm.ok || !ctx?.organizationId) {
        send({
          type: "error",
          topic: topicRaw,
          code: perm.ok ? "auth.unauthenticated" : perm.code,
        });
        return;
      }
      const orgId = ctx.organizationId;
      const depId = topic.id;
      let status: string;
      try {
        status = (await deploymentsService.getDeployment(app.db, orgId, depId)).status;
      } catch {
        send({ type: "error", topic: topicRaw, code: "not_found" });
        return;
      }

      // Subscribe FIRST (buffer live frames), then replay from the DB, then flush
      // the buffer skipping anything already in the replay — no gaps, no dupes.
      let lastSeq = 0;
      let ready = false;
      const buffer: LogFrame[] = [];
      const sendLog = (f: LogFrame) => {
        if (f.seq <= lastSeq) return;
        lastSeq = f.seq;
        send({ type: "log", topic: topicRaw, line: f });
      };
      const unsubLog = logBus.onLog(depId, (f) => (ready ? sendLog(f) : buffer.push(f)));
      const unsubStatus = logBus.onStatus(depId, (s) =>
        send({
          type: "deployment",
          topic: topicRaw,
          deployment: { deploymentId: depId, status: s },
        }),
      );
      subs.set(topicRaw, () => {
        unsubLog();
        unsubStatus();
      });

      send({ type: "subscribed", topic: topicRaw });
      const { lines } = await deploymentsService.getDeploymentLogs(app.db, orgId, depId, {});
      send({ type: "replay", topic: topicRaw, lines });
      for (const l of lines) lastSeq = Math.max(lastSeq, l.seq);
      ready = true;
      for (const f of buffer) sendLog(f);
      if (status === "succeeded" || status === "failed") {
        send({ type: "deployment", topic: topicRaw, deployment: { deploymentId: depId, status } });
      }
    };

    socket.on("message", (raw: unknown) => {
      let msg: ClientMessage;
      try {
        const text = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw);
        msg = JSON.parse(text) as ClientMessage;
      } catch {
        send({ type: "error", code: "bad_message" });
        return;
      }
      if (msg.type === "ping") {
        send({ type: "pong" });
      } else if (msg.type === "unsubscribe" && msg.topic) {
        subs.get(msg.topic)?.();
        subs.delete(msg.topic);
      } else if (msg.type === "subscribe" && msg.topic) {
        void subscribe(msg.topic).catch(() => {
          send({ type: "error", topic: msg.topic, code: "internal", message: "subscribe failed" });
        });
      }
    });

    socket.on("close", () => {
      for (const unsub of subs.values()) unsub();
      subs.clear();
    });
  });
};
