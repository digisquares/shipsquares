import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type as T } from "@sinclair/typebox";
import { sql } from "drizzle-orm";

const Health = T.Object({ status: T.String() });

// Registered at the root (outside /api/v1): liveness/readiness probes.
export const healthRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get("/healthz", { schema: { tags: ["system"], response: { 200: Health } } }, () => ({
    status: "ok",
  }));
  // Readiness actually checks Postgres — a constant "ready" while the DB is
  // down just shifts the outage downstream.
  app.get(
    "/readyz",
    { schema: { tags: ["system"], response: { 200: Health, 503: Health } } },
    async (_req, reply) => {
      try {
        await app.db.execute(sql`select 1`);
        return { status: "ready" };
      } catch {
        reply.code(503);
        return { status: "unready" };
      }
    },
  );
};
