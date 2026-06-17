import fp from "fastify-plugin";

import { auditEventFromRequest, recordAudit } from "../services/audit.service.js";

// Audit every successful authed mutation (05-auth-rbac.md) from one hook —
// the pure mapper decides what counts; recording is fire-safe and off the
// response path (the client never waits on the audit insert).
export const auditPlugin = fp(async (app) => {
  app.addHook("onResponse", (req, reply, done) => {
    const ctx = req.ctx; // undefined on requests that never hit the auth hook
    if (ctx) {
      const event = auditEventFromRequest({
        method: req.method,
        routeUrl: req.routeOptions.url ?? req.url,
        params: (req.params ?? {}) as Record<string, unknown>,
        statusCode: reply.statusCode,
        ctx,
      });
      if (event) void recordAudit(app.db, event);
    }
    done();
  });
});
