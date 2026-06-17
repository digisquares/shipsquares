import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

import { registryCredentials } from "./app-runtime.js";
import { buildStrategy } from "./enums.js";
import { organizations } from "./organizations.js";
import { servers } from "./servers.js";
import { vcsConnections } from "./vcs.js";

export type BuildConfig = {
  strategy: "compose" | "dockerfile" | "nixpacks" | "buildpacks" | "static";
  dockerfilePath?: string;
  buildArgs?: Record<string, string>;
  rootDirectory?: string;
  publishDirectory?: string; // static
  builder?: string; // buildpacks: CNB builder image
};

export type HealthCheck = {
  type: "http" | "cmd";
  path?: string;
  port?: number;
  cmd?: string;
  interval?: number;
  timeout?: number;
  retries?: number;
  startPeriod?: number;
};

export const apps = pgTable(
  "apps",
  {
    id: text("id").primaryKey(), // app_…
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    serverId: text("server_id").references(() => servers.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    repo: text("repo"), // git url (null for catalog/docker-image apps)
    image: text("image"), // docker image ref for image-source apps (pull + run, no build)
    branch: text("branch").notNull().default("main"),
    port: integer("port").notNull().default(8080), // container listen port to publish/route

    composePath: text("compose_path").default("docker-compose.yml"),
    service: text("service"), // service in compose to expose
    buildStrategy: buildStrategy("build_strategy").notNull().default("compose"),
    buildConfig: jsonb("build_config")
      .$type<BuildConfig>()
      .notNull()
      .default({ strategy: "compose" }),
    vcsConnectionId: text("vcs_connection_id").references(() => vcsConnections.id, {
      onDelete: "set null",
    }),
    rollbackEnabled: boolean("rollback_enabled").notNull().default(true),
    // Webhookless auto-deploy: the git-poll cron tracks the branch head (R2.1)
    gitPollEnabled: boolean("git_poll_enabled").notNull().default(false),
    // Pre/post-deploy hooks (06): pre runs in a throwaway container of the new
    // image before the swap; post execs in the running container after health.
    preDeployCommand: text("pre_deploy_command"),
    postDeployCommand: text("post_deploy_command"),
    imagesToKeep: integer("images_to_keep").notNull().default(5), // rollback image retention (06)
    // Resource allocation — applied to the run spec (06); usage charted in 32.
    cpuLimit: numeric("cpu_limit"),
    cpuReservation: numeric("cpu_reservation"),
    memLimitBytes: bigint("mem_limit_bytes", { mode: "number" }),
    memReservationBytes: bigint("mem_reservation_bytes", { mode: "number" }),
    replicas: integer("replicas").notNull().default(1),
    restartPolicy: text("restart_policy").notNull().default("unless-stopped"),
    healthCheck: jsonb("health_check").$type<HealthCheck>(),
    registryCredentialId: text("registry_credential_id").references(() => registryCredentials.id, {
      onDelete: "set null",
    }),
    // Preview / PR environments (31)
    previewEnabled: boolean("preview_enabled").notNull().default(false),
    previewWildcardDomain: text("preview_wildcard_domain"),
    previewLimit: integer("preview_limit").notNull().default(5),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    orgIdx: index("apps_org_idx").on(t.organizationId),
    orgNameUq: unique("apps_org_name_uq").on(t.organizationId, t.name),
    serverIdx: index("apps_server_idx").on(t.serverId),
  }),
);
