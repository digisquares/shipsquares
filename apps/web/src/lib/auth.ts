import { twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

// better-auth React client, talking to the control plane mounted at /auth/*
// (same origin — the SPA is served by the control plane). 05-auth-rbac.md.
// The twoFactor client plugin mirrors the server twoFactor plugin (R3.3).
export const authClient = createAuthClient({
  baseURL: typeof window !== "undefined" ? window.location.origin : "",
  basePath: "/auth",
  plugins: [twoFactorClient()],
});

export const { useSession, signIn, signOut, twoFactor } = authClient;
