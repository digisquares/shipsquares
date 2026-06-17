import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import fastifyStatic from "@fastify/static";
import fp from "fastify-plugin";

// Serve the built web SPA (apps/web) when it's present at the bundle root's
// `public/` dir (build-bundle.sh copies apps/web/dist there). Skipped in dev and
// tests, where the dir doesn't exist and the SPA runs via the Vite dev server —
// so app.inject() tests are unaffected. The API/auth/health routes are registered
// before this and take precedence over the static wildcard.
export const staticPlugin = fp(async (app) => {
  // compiled: <root>/dist/plugins/static.js -> <root>/public
  const root = join(dirname(fileURLToPath(import.meta.url)), "../../public");
  if (!existsSync(root)) {
    app.log.info?.("web SPA not bundled (no public/); skipping static serving");
    return;
  }
  await app.register(fastifyStatic, { root, index: "index.html" });
});
