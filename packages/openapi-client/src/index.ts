import createOpenApiClient from "openapi-fetch";

import type { paths } from "./schema.js";

// Typed fetch client over the committed openapi.json. The generated paths are
// prefix-less ("/apps") with /api/v1 carried in the spec's servers[] — which
// openapi-fetch ignores — so the wrapper owns the prefix. Auth: the server is
// cookie-session today (pass the better-auth cookie); bearer tokens slot in
// when API keys (05) land. `./schema.d.ts` regenerates via
// `pnpm -F @ss/openapi-client generate` and is drift-gated in CI.

export interface ClientOptions {
  /** better-auth session cookie ("better-auth.session_token=…") */
  cookie?: string;
  /** future API-key path — sent as Authorization: Bearer */
  getToken?: () => string | undefined;
  /** injected for tests */
  fetchImpl?: typeof fetch;
}

export function createClient(baseUrl: string, opts: ClientOptions = {}) {
  const base = `${baseUrl.replace(/\/+$/, "")}/api/v1`;
  return createOpenApiClient<paths>({
    baseUrl: base,
    fetch: (request) => {
      if (opts.cookie) request.headers.set("cookie", opts.cookie);
      const token = opts.getToken?.();
      if (token) request.headers.set("Authorization", `Bearer ${token}`);
      return (opts.fetchImpl ?? fetch)(request);
    },
  });
}

export type ApiClient = ReturnType<typeof createClient>;
export type { components, paths } from "./schema.js";
