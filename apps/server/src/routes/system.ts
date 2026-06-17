import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type as T } from "@sinclair/typebox";

import { getAppVersion } from "../lib/version.js";
import { Problem } from "../schemas/common.js";
import * as updates from "../services/update-check.service.js";

// System / update-notification REST (auto-update.md · Phase 1). Reads are open to
// any member (update:read); the on-demand re-check is owner/admin (update:write).
// Applying an update is a later phase and not exposed here yet.

const VersionView = T.Object({ version: T.String(), channel: T.String() });

const UpdateStateView = T.Object({
  currentVersion: T.String(),
  latestVersion: T.Union([T.String(), T.Null()]),
  channel: T.String(),
  updateAvailable: T.Boolean(),
  notesUrl: T.Union([T.String(), T.Null()]),
  releasedAt: T.Union([T.String(), T.Null()]),
  lastCheckedAt: T.Union([T.String(), T.Null()]),
  lastError: T.Union([T.String(), T.Null()]),
});

const ApplyResult = T.Object({
  accepted: T.Boolean(),
  fromVersion: T.String(),
  toVersion: T.String(),
});

const UpdateProgress = T.Object({
  state: T.Union([T.Literal("idle"), T.Literal("running"), T.Literal("done"), T.Literal("failed")]),
  step: T.Union([T.String(), T.Null()]),
  fromVersion: T.Union([T.String(), T.Null()]),
  toVersion: T.Union([T.String(), T.Null()]),
  message: T.Union([T.String(), T.Null()]),
  ts: T.Union([T.String(), T.Null()]),
});

const UpdateSettings = T.Object({ channel: T.String(), autoUpdate: T.Boolean() });

const UpdateSettingsPatch = T.Object(
  {
    channel: T.Optional(T.Union([T.Literal("stable"), T.Literal("beta"), T.Literal("canary")])),
    autoUpdate: T.Optional(T.Boolean()),
  },
  { additionalProperties: false },
);

export const systemRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/system/version",
    {
      schema: { tags: ["system"], response: { 200: VersionView } },
      preHandler: app.requirePermission("update:read"),
    },
    async () => ({ version: getAppVersion(app.config), channel: app.config.SS_RELEASE_CHANNEL }),
  );

  app.get(
    "/system/updates",
    {
      schema: { tags: ["system"], response: { 200: UpdateStateView } },
      preHandler: app.requirePermission("update:read"),
    },
    async () => updates.getUpdateState(app.db, app.config),
  );

  app.post(
    "/system/updates/check",
    {
      schema: { tags: ["system"], response: { 200: UpdateStateView } },
      preHandler: app.requirePermission("update:write"),
    },
    async () => updates.checkForUpdate(app.db, app.config),
  );

  // Phase 2: hand the update off to the root updater (writes the request file the
  // shipsquares-updater.path unit watches). 409 if already current / no artifact,
  // 503 if the manifest is unreachable.
  app.post(
    "/system/updates/apply",
    {
      schema: { tags: ["system"], response: { 202: ApplyResult, 409: Problem, 503: Problem } },
      preHandler: app.requirePermission("update:write"),
    },
    async (_req, reply) => {
      const result = await updates.applyUpdate(app.db, app.config);
      reply.code(202);
      return result;
    },
  );

  // Updater progress (status file). The API restarts mid-update, so the client
  // polls this and tolerates the gap until /readyz returns and state flips.
  app.get(
    "/system/updates/progress",
    {
      schema: { tags: ["system"], response: { 200: UpdateProgress } },
      preHandler: app.requirePermission("update:read"),
    },
    async () => updates.getUpdateProgress(app.config),
  );

  // Phase 3: tracked channel + opt-in auto-apply.
  app.get(
    "/system/updates/settings",
    {
      schema: { tags: ["system"], response: { 200: UpdateSettings } },
      preHandler: app.requirePermission("update:read"),
    },
    async () => updates.getUpdateSettings(app.db, app.config),
  );

  app.put(
    "/system/updates/settings",
    {
      schema: { tags: ["system"], body: UpdateSettingsPatch, response: { 200: UpdateSettings } },
      preHandler: app.requirePermission("update:write"),
    },
    async (req) => updates.setUpdateSettings(app.db, app.config, req.body),
  );
};
