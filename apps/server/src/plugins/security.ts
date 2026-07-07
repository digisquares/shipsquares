import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fp from "fastify-plugin";

import { corsOrigins } from "../lib/cors-origins.js";
import { toProblem } from "../lib/problem.js";

// helmet + cors + rate-limit. The in-process rate-limit store protects the
// control plane; it does not cap tenants (platform "no artificial limits"). The
// credential-submitting /auth/* endpoints get a tighter per-IP tier on top of
// this (see auth/rate-tier.ts, wired in auth/plugin.ts). CORS is allowlist-only:
// with cookie sessions, reflecting arbitrary origins with credentials would hand
// the API to any page a victim visits.
export const DEFAULT_RATE_LIMIT = 1000;

export const securityPlugin = fp(async (app) => {
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: corsOrigins(app.config), credentials: true });
  await app.register(rateLimit, {
    max: DEFAULT_RATE_LIMIT,
    timeWindow: "1 minute",
    errorResponseBuilder: (req, context) =>
      toProblem(
        { statusCode: 429, message: `Rate limit exceeded, retry in ${context.after}` },
        req.url,
      ),
  });
});
