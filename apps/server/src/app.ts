import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";

import { authPlugin } from "./auth/plugin.js";
import { dbStudioPool } from "./dbstudio/pool.js";
import { auditPlugin } from "./plugins/audit.js";
import { configPlugin } from "./plugins/config.js";
import { dbPlugin } from "./plugins/db.js";
import { errorHandlerPlugin } from "./plugins/error-handler.js";
import { queuePlugin } from "./plugins/queue.js";
import { securityPlugin } from "./plugins/security.js";
import { staticPlugin } from "./plugins/static.js";
import { swaggerPlugin } from "./plugins/swagger.js";
import { consoleWsRoutes } from "./routes/console-ws.js";
import { healthRoutes } from "./routes/health.js";
import { hooksRoutes } from "./routes/hooks.js";
import { v1Routes } from "./routes/index.js";
import { mcpRoutes } from "./routes/mcp.js";
import { prometheusRoutes } from "./routes/prometheus.js";
import { tlsAskRoutes } from "./routes/tls-ask.js";
import { vcsGithubRoutes } from "./routes/vcs-github.js";
import { wsRoutes } from "./routes/ws.js";

/**
 * Build the Fastify control-plane instance: a tree of plugins in a fixed boot
 * order (config → db → queue → security → auth → swagger → error-handler →
 * routes). Pure and side-effect-free at the network layer — no listener, no DB
 * query — so it can be exercised with `app.inject()` and by `openapi:emit`.
 * Route typing comes from each resource's `FastifyPluginAsyncTypebox`.
 */
export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    // Strict bodies: reject (not silently strip) additionalProperties; still
    // coerce querystrings + apply defaults; report all validation errors.
    ajv: {
      customOptions: {
        removeAdditional: false,
        coerceTypes: true,
        useDefaults: true,
        allErrors: true,
      },
    },
  });

  await app.register(configPlugin);
  await app.register(dbPlugin);
  await app.register(queuePlugin);
  await app.register(securityPlugin);
  await app.register(authPlugin);
  await app.register(auditPlugin); // after auth: req.ctx is resolved for the onResponse hook
  await app.register(websocket); // WS upgrades go through the onRequest auth hook
  await app.register(swaggerPlugin);
  await app.register(errorHandlerPlugin);

  await app.register(healthRoutes);
  await app.register(prometheusRoutes); // /metrics Prometheus endpoint (R6.4)
  await app.register(hooksRoutes); // public, signature-verified inbound webhooks
  await app.register(vcsGithubRoutes); // public, install-state-verified GitHub App callback
  await app.register(tlsAskRoutes); // loopback-only Caddy on-demand TLS gate
  await app.register(mcpRoutes); // /mcp streamable-HTTP MCP server (bearer/session-authed)
  await app.register(v1Routes, { prefix: "/api/v1" });
  await app.register(wsRoutes, { prefix: "/api/v1" }); // /api/v1/ws live logs
  await app.register(consoleWsRoutes, { prefix: "/api/v1" }); // /api/v1/ws/console exec console
  // Static SPA last so explicit API/auth/health routes take precedence.
  await app.register(staticPlugin);

  // Close pooled Database Studio drivers on shutdown (database-studio/01).
  app.addHook("onClose", async () => {
    await dbStudioPool.closeAll();
  });

  await app.ready();
  return app;
}
