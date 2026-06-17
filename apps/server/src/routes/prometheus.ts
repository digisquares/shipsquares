import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type as T } from "@sinclair/typebox";

import { collectPrometheusMetrics, formatPrometheusOutput } from "../metrics/prometheus.js";

// Prometheus metrics endpoint (R6.4). Exposed at /metrics (outside /api/v1)
// for standard Prometheus scraping. Optionally protected by a bearer token.

export const prometheusRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/metrics",
    {
      schema: {
        tags: ["system"],
        response: {
          200: T.String({ description: "Prometheus exposition format metrics" }),
          401: T.Object({ error: T.String() }),
        },
      },
    },
    async (req, reply) => {
      // Optional auth via METRICS_TOKEN env (for production scraping)
      const metricsToken = app.config.METRICS_TOKEN;
      if (metricsToken) {
        const auth = req.headers.authorization;
        if (!auth || auth !== `Bearer ${metricsToken}`) {
          reply.code(401);
          return { error: "unauthorized" };
        }
      }

      const metrics = await collectPrometheusMetrics(app.db);
      reply.type("text/plain; version=0.0.4; charset=utf-8");
      return formatPrometheusOutput(metrics);
    },
  );
};
