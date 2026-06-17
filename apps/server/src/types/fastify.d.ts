import type { Env } from "@ss/shared";
import type { preHandlerAsyncHookHandler } from "fastify";
import type PgBoss from "pg-boss";

import type { Auth } from "../auth/better-auth.js";
import type { Db } from "../db/index.js";
import type { RequestContext } from "../lib/ctx.js";
import type { Permission } from "../rbac/permissions.js";

// Decorator + request augmentations wired by the plugins (config/db/queue/auth).
declare module "fastify" {
  interface FastifyInstance {
    config: Env;
    db: Db;
    queue: PgBoss;
    auth: Auth;
    requirePermission(permission: Permission): preHandlerAsyncHookHandler;
  }
  interface FastifyRequest {
    ctx?: RequestContext;
  }
}
