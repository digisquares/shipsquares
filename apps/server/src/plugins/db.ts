import fp from "fastify-plugin";

import { db } from "../db/index.js";

// Decorate the drizzle client (postgres.js connects lazily, so this is safe in
// tests and `openapi:emit` which never issue a query).
export const dbPlugin = fp(async (app) => {
  app.decorate("db", db);
});
