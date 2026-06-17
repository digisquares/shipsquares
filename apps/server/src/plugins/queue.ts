import fp from "fastify-plugin";

import { createBoss } from "../db/queue.js";

// Decorate pg-boss but do NOT start it here — `boss.start()` connects to Postgres
// and is called from the server entrypoint once the DB is reachable, so buildApp
// stays usable in tests and `openapi:emit`. Jobs are wired in 06-deploy-engine.md.
export const queuePlugin = fp(async (app) => {
  app.decorate("queue", createBoss());
  app.addHook("onClose", async () => {
    try {
      await app.queue.stop({ graceful: true, timeout: 5000 });
    } catch {
      // never started (tests, openapi:emit) — nothing to stop
    }
  });
});
