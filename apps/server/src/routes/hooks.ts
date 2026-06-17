import type { FastifyPluginAsync } from "fastify";

import { handleAppInbound, handleInbound } from "../services/webhooks.service.js";

// Public inbound webhook endpoint (10-webhooks-vcs.md). NOT under /api/v1 and not
// session-authed: the HMAC signature IS the auth. Encapsulated so the raw-buffer
// content-type parser (needed to verify the signature over the exact bytes) is
// scoped here and doesn't affect JSON parsing on the rest of the API.
export const hooksRoutes: FastifyPluginAsync = async (app) => {
  // Drop the inherited JSON parser in THIS context and treat every body as a raw
  // buffer, so the HMAC is computed over the exact bytes (the inherited
  // application/json parser would otherwise win for Content-Type: application/json).
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("*", { parseAs: "buffer" }, (_req, body, done) => {
    done(null, body);
  });

  app.post<{ Params: { id: string }; Querystring: { token?: string } }>(
    "/hooks/:id",
    async (req, reply) => {
      const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
      const result = await handleInbound(
        app.db,
        app.config,
        req.params.id,
        req.headers,
        rawBody,
        app.queue,
        // Bitbucket has no signature header — its hook URL carries ?token=.
        typeof req.query.token === "string" ? req.query.token : undefined,
      );
      return reply.code(result.status).send(result.body);
    },
  );

  // App-level webhook for manifest-created GitHub Apps (R2.7): a single hook for
  // the whole App, resolved to its sealed secret by the app-id header, fanning
  // out push→deploy / pull_request→preview across the installation's bound apps.
  app.post("/hooks/github/app", async (req, reply) => {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
    const result = await handleAppInbound(app.db, app.config, req.headers, rawBody, app.queue);
    return reply.code(result.status).send(result.body);
  });
};
