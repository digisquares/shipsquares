import { type APIRequestContext } from "@playwright/test";

// Full-stack seeding helpers (PLAYWRIGHT_STACK=full). These talk to the REAL
// control plane the same way the installer/vm-tests do — no DB pokes.
//
// NOTE: a deterministic seeded owner is tracked as MCL-1 in
// docs/testing/07-major-changes-log.md. Until scripts/e2e-seed.mjs exists, the
// full project is expected to fail-fast with a clear message here.

export const E2E_OWNER = {
  email: process.env.E2E_OWNER_EMAIL ?? "e2e-owner@local.test",
  password: process.env.E2E_OWNER_PASSWORD ?? "",
};

/** Sign in via the real /auth endpoint and return cookies for an API context. */
export async function signInOwner(request: APIRequestContext, baseURL: string): Promise<void> {
  if (!E2E_OWNER.password) {
    throw new Error(
      "Full-stack E2E needs E2E_OWNER_PASSWORD for a seeded owner (see MCL-1). " +
        "Run scripts/e2e-seed.mjs against the control plane first.",
    );
  }
  const res = await request.post(`${baseURL}/auth/sign-in/email`, {
    data: { email: E2E_OWNER.email, password: E2E_OWNER.password },
  });
  if (!res.ok()) throw new Error(`seed sign-in failed: ${res.status()}`);
}

/** Create an app via the real API; returns its id. */
export async function createApp(
  request: APIRequestContext,
  baseURL: string,
  body: { name: string; repo?: string; port?: number },
): Promise<string> {
  const res = await request.post(`${baseURL}/api/v1/apps`, { data: body });
  if (!res.ok()) throw new Error(`createApp failed: ${res.status()}`);
  return ((await res.json()) as { id: string }).id;
}
