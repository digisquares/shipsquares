import type { Env } from "@ss/shared";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { twoFactor } from "better-auth/plugins";

import { db } from "../db/index.js";
import { trustedOriginsFor } from "../lib/cors-origins.js";

import { ssoProviders } from "./sso.js";

// The better-auth instance (05-auth-rbac.md). Identity = better-auth; the
// authorization policy (roles/permissions/tenant-scope) is ours. The Drizzle
// adapter writes into our control DB (03); `usePlural` maps better-auth's
// singular models (user/session/account/verification) onto our plural tables.
//
// Phase-0 surface: email+password + sessions, mounted at /auth/*. The
// organization/apiKey/passkey/twoFactor/social plugins are deferred (org+role
// come from our own `memberships` table via roleFor(), so login works without
// them) — tracked in 05-auth-rbac.md. Public self-signup stays enabled for the
// bootstrap; lock it to invitations before GA.
// Annotate the return so the exported type is nameable: the twoFactor plugin
// drags zod-v4 core into the inferred type (TS2742, the documented zod-version
// tension). The base instance type carries `.handler` + `.api.getSession`,
// which is all the resolver/plugin use; the cast bridges the plugin-typed
// instance to it.
type AuthInstance = ReturnType<typeof betterAuth>;

export function buildAuth(config: Env): AuthInstance {
  const { providers } = ssoProviders(config);
  return betterAuth({
    database: drizzleAdapter(db, { provider: "pg", usePlural: true }),
    secret: config.AUTH_SECRET,
    baseURL: config.AUTH_URL,
    basePath: "/auth",
    // Social login (R3.2): only present-and-complete providers; reuses the
    // existing accounts table. Empty object = feature off.
    ...(Object.keys(providers).length > 0 ? { socialProviders: providers } : {}),
    // Allowlist (AUTH_URL + AUTH_TRUSTED_ORIGINS) PLUS the request's own
    // origin — same-origin login works at any host that reaches the server
    // (IP/domain/tunnel) with zero config, the Coolify/Dokploy model. The
    // bridge feeds better-auth the REAL request host (requestBaseUrl).
    trustedOrigins: trustedOriginsFor(config),
    // Self-signup is lockable once invites are the onboarding path (R3.x).
    emailAndPassword: { enabled: true, disableSignUp: !config.ALLOW_SIGNUP },
    session: { expiresIn: 60 * 60 * 24 * 7 }, // 7 days
    // 2FA (R3.3): TOTP + backup codes. Off until a user enrols
    // (users.two_factor_enabled defaults false), so existing logins are
    // unchanged; the issuer names the authenticator entry.
    plugins: [twoFactor({ issuer: "ShipSquares" })],
  }) as unknown as AuthInstance;
}

export type Auth = AuthInstance;
