import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type as T } from "@sinclair/typebox";

import { collectPrometheusMetrics, formatPrometheusOutput } from "../metrics/prometheus.js";

// Prometheus metrics endpoint (R6.4). Exposed at /metrics (outside /api/v1) for
// standard Prometheus scraping. The exposition carries per-app cpu/memory series
// labelled by app_id across ALL orgs, so it must not be world-readable: set
// METRICS_TOKEN and scrape with `Authorization: Bearer <token>`. In production a
// token is REQUIRED — an unset token fails closed (503) rather than serving
// cross-tenant data anonymously. Dev/test stay open for convenience.

/** Access decision for a /metrics scrape (pure, so the three branches are
 *  testable without booting the server). */
export function metricsAccess(input: {
  token: string | undefined;
  authorization: string | undefined;
  nodeEnv: string;
}): { ok: true } | { ok: false; status: 401 | 503; error: string } {
  if (input.token) {
    if (input.authorization === `Bearer ${input.token}`) return { ok: true };
    return { ok: false, status: 401, error: "unauthorized" };
  }
  if (input.nodeEnv === "production") {
    return {
      ok: false,
      status: 503,
      error: "metrics endpoint disabled: set METRICS_TOKEN to enable scraping",
    };
  }
  return { ok: true };
}

export const prometheusRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/metrics",
    {
      schema: {
        tags: ["system"],
        response: {
          200: T.String({ description: "Prometheus exposition format metrics" }),
          401: T.Object({ error: T.String() }),
          503: T.Object({ error: T.String() }),
        },
      },
    },
    async (req, reply) => {
      const decision = metricsAccess({
        token: app.config.METRICS_TOKEN,
        authorization: req.headers.authorization,
        nodeEnv: app.config.NODE_ENV,
      });
      if (!decision.ok) {
        reply.code(decision.status);
        return { error: decision.error };
      }

      const metrics = await collectPrometheusMetrics(app.db);
      reply.type("text/plain; version=0.0.4; charset=utf-8");
      return formatPrometheusOutput(metrics);
    },
  );
};
