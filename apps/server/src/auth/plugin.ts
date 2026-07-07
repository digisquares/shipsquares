import fp from "fastify-plugin";

import { requestBaseUrl } from "../lib/cors-origins.js";
import { swallow } from "../lib/swallow.js";
import { DEFAULT_RATE_LIMIT } from "../plugins/security.js";
import { requirePermission } from "../rbac/require-permission.js";

import { buildAuth } from "./better-auth.js";
import { authRateMax } from "./rate-tier.js";
import { ANON, resolveContext } from "./resolver.js";
import { ssoProviders } from "./sso.js";

// Auth plugin (05-auth-rbac.md): builds the better-auth instance, mounts its
// handler at /auth/*, decorates `app.auth` + the real `requirePermission`, and
// resolves every request's credential into `req.ctx` via an onRequest hook
// (runs before each route's requirePermission preHandler).
export const authPlugin = fp(async (app) => {
  const auth = buildAuth(app.config);
  app.decorate("auth", auth);
  app.decorate("requirePermission", requirePermission);

  // Bridge Fastify <-> better-auth's web-standard handler. Fastify has already
  // parsed the JSON body, so reconstruct a web Request from it. Set-Cookie must
  // be forwarded as a list (Headers.forEach would fold multiple cookies into one).
  app.route({
    method: ["GET", "POST"],
    url: "/auth/*",
    // S5: credential-submitting auth endpoints (sign-in/up, 2FA, password reset)
    // get a tight per-IP budget instead of the coarse global 1000/min; reads like
    // /auth/get-session keep the default so session polling isn't throttled. A
    // per-route override only applies when the rate-limit plugin is registered
    // (production); it's a harmless no-op in app.inject tests without it.
    config: {
      rateLimit: {
        timeWindow: "1 minute",
        max: (req: { url: string }) => authRateMax(req.url, DEFAULT_RATE_LIMIT),
      },
    },
    async handler(req, reply) {
      // Build the auth Request on the host the browser actually used (not
      // AUTH_URL) so same-origin login works at any reachable host.
      const url = new URL(req.url, requestBaseUrl(req.headers, req.protocol, app.config.AUTH_URL));
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (Array.isArray(v)) headers.set(k, v.join(", "));
        else if (v != null) headers.set(k, String(v));
      }
      const init: RequestInit = { method: req.method, headers };
      if (req.method !== "GET" && req.method !== "HEAD" && req.body != null) {
        init.body = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
        if (!headers.has("content-type")) headers.set("content-type", "application/json");
      }

      const res = await auth.handler(new Request(url, init));

      reply.status(res.status);
      const setCookies =
        typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
      res.headers.forEach((val, key) => {
        if (key.toLowerCase() !== "set-cookie") reply.header(key, val);
      });
      if (setCookies.length > 0) reply.header("set-cookie", setCookies);
      reply.send(await res.text());
    },
  });

  // Public: which SSO providers are configured, so the login screen renders
  // only available buttons. No secrets — just the enabled provider ids.
  const { enabled } = ssoProviders(app.config);
  app.get("/sso-providers", async () => ({ providers: enabled }));

  app.addHook("onRequest", async (req) => {
    try {
      req.ctx = await resolveContext(auth, req);
    } catch (err) {
      // resolveContext returns ANON for anonymous requests, so a throw here is a
      // real fault (session store / DB) — log before downgrading, else it looks
      // like a spurious 401/403 to the caller.
      swallow("auth.resolve", err);
      req.ctx = ANON;
    }
  });
});
