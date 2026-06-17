import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type as T } from "@sinclair/typebox";
import { eq } from "drizzle-orm";

import { domains } from "../db/schema/index.js";
import { ASK_PATH, answerAsk } from "../proxy/ask.js";

// Caddy's on-demand TLS gate (08-proxy-ssl.md): before issuing a cert for an
// unknown SNI, Caddy GETs ?domain= here; 200 allows issuance. Caddy runs on
// this host and cannot authenticate, so the route is public but loopback-only.

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

const Answer = T.Object({ allow: T.Boolean() });

export const tlsAskRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    ASK_PATH,
    {
      schema: {
        tags: ["proxy"],
        querystring: T.Object({ domain: T.String({ minLength: 1, maxLength: 255 }) }),
        response: { 200: Answer, 403: Answer },
      },
    },
    async (req, reply) => {
      if (!LOOPBACK.has(req.ip)) {
        reply.code(403);
        return { allow: false };
      }
      const row = (
        await app.db
          .select({ certStatus: domains.certStatus })
          .from(domains)
          .where(eq(domains.fqdn, req.query.domain))
          .limit(1)
      )[0];
      const result = answerAsk(req.query.domain, () => row?.certStatus);
      reply.code(result.status);
      return { allow: result.allow };
    },
  );
};
