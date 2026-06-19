import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type as T } from "@sinclair/typebox";
import { AppError, UnauthorizedError } from "@ss/shared";
import type { FastifyPluginAsync } from "fastify";

import {
  DEFAULT_DEVICE_REDIRECT,
  deviceLoginScopes,
  deviceTokenName,
  isAllowedDeviceRedirect,
} from "../auth/login-flow.js";
import { getCtx } from "../lib/ctx.js";
import { Problem } from "../schemas/common.js";
import * as apiKeysService from "../services/api-keys.service.js";

/**
 * Browser entry point for the device Login Flow (docs/mobile/01). Registered at the
 * root (not /api/v1) so a native app can open `${baseUrl}/login/flow?redirect=ss://login`
 * directly. It validates the redirect, then bounces into the hash-routed SPA, which
 * reuses the control plane's own login + a consent step. Returns HTML/redirects, so it
 * lives outside the typed JSON API.
 */
export const loginFlowRedirectRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { redirect?: string } }>("/login/flow", async (req, reply) => {
    const redirect =
      typeof req.query.redirect === "string" && req.query.redirect
        ? req.query.redirect
        : DEFAULT_DEVICE_REDIRECT;
    if (!isAllowedDeviceRedirect(redirect)) {
      return reply
        .code(400)
        .type("text/plain; charset=utf-8")
        .send("Invalid redirect target for device login.");
    }
    // Hand off to the SPA (hash router): it authenticates via the normal login gate —
    // a reload after sign-in returns to this same hash — then shows the consent step.
    return reply.redirect(`/#/login-flow?redirect=${encodeURIComponent(redirect)}`);
  });
};

const AuthorizeBody = T.Object(
  {
    redirect: T.Optional(T.String({ maxLength: 512 })),
    name: T.Optional(T.String({ maxLength: 120 })),
  },
  { additionalProperties: false },
);
const AuthorizeResult = T.Object({ token: T.String() });

/**
 * Mint a device-scoped token for the signed-in user (the consent step's POST). A real
 * user session only — never an API key minting another key — and scoped to
 * deployer ∩ the user's role so it can't exceed what the user holds. The raw token is
 * returned once; the SPA hands it to the app over the deep link.
 */
export const loginFlowAuthorizeRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.post(
    "/login/flow/authorize",
    {
      schema: {
        tags: ["auth"],
        body: AuthorizeBody,
        response: { 201: AuthorizeResult, 400: Problem, 401: Problem },
      },
    },
    async (req, reply) => {
      const ctx = getCtx(req);
      if (ctx.via !== "session" || !ctx.organizationId || !ctx.role || !ctx.actor.userId) {
        throw new UnauthorizedError("a signed-in session is required to authorize a device");
      }
      const redirect = req.body.redirect ?? DEFAULT_DEVICE_REDIRECT;
      if (!isAllowedDeviceRedirect(redirect)) {
        throw new AppError("invalid device redirect target", {
          status: 400,
          code: "login_flow.bad_redirect",
        });
      }
      const { token } = await apiKeysService.createApiKey(
        app.db,
        ctx.organizationId,
        ctx.actor.userId,
        {
          name: deviceTokenName(req.body.name),
          scopes: deviceLoginScopes(ctx.role),
        },
      );
      reply.code(201);
      return { token };
    },
  );
};
