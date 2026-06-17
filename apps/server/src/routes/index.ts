import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";

import { apiKeysRoutes } from "./api-keys.js";
import { appsRoutes } from "./apps.js";
import { auditRoutes } from "./audit.js";
import { backupsRoutes } from "./backups.js";
import { catalogServicesRoutes } from "./catalog-services.js";
import { catalogRoutes } from "./catalog.js";
import { chatRoutes } from "./chat.js";
import { connectionsRoutes } from "./connections.js";
import { databasesRoutes } from "./databases.js";
import { dbStudioRoutes } from "./dbstudio.js";
import { deploymentsRoutes } from "./deployments.js";
import { domainsRoutes } from "./domains.js";
import { envRoutes } from "./env.js";
import { mailRoutes } from "./mail.js";
import { membersRoutes } from "./members.js";
import { metricAlertsRoutes } from "./metric-alerts.js";
import { notificationsRoutes } from "./notifications.js";
import { organizationsRoutes } from "./organizations.js";
import { outboundWebhooksRoutes } from "./outbound-webhooks.js";
import { previewsRoutes } from "./previews.js";
import { registryCredentialsRoutes } from "./registry-credentials.js";
import { replicasRoutes } from "./replicas.js";
import { schedulesRoutes } from "./schedules.js";
import { serversRoutes } from "./servers.js";
import { systemRoutes } from "./system.js";
import { webhookRoutes } from "./webhook.js";

// All v1 resource plugins, registered under the /api/v1 prefix by buildApp.
// Resources are added here as their service layers land in later phases.
export const v1Routes: FastifyPluginAsyncTypebox = async (app) => {
  await app.register(organizationsRoutes);
  await app.register(serversRoutes);
  await app.register(appsRoutes);
  await app.register(deploymentsRoutes);
  await app.register(domainsRoutes);
  await app.register(connectionsRoutes);
  await app.register(envRoutes);
  await app.register(webhookRoutes);
  await app.register(notificationsRoutes);
  await app.register(outboundWebhooksRoutes);
  await app.register(schedulesRoutes);
  await app.register(auditRoutes);
  await app.register(catalogRoutes);
  await app.register(databasesRoutes);
  await app.register(dbStudioRoutes);
  await app.register(mailRoutes);
  await app.register(backupsRoutes);
  await app.register(previewsRoutes);
  await app.register(registryCredentialsRoutes);
  await app.register(replicasRoutes);
  await app.register(apiKeysRoutes);
  await app.register(membersRoutes);
  await app.register(metricAlertsRoutes);
  await app.register(catalogServicesRoutes);
  await app.register(chatRoutes);
  await app.register(systemRoutes);
};
