/**
 * Resource-scope validation (R3.5). A structural middleware that validates
 * org ownership of resources BEFORE route handlers execute, providing tenant
 * isolation as a middleware layer rather than per-service guards.
 *
 * This complements the existing per-service `eq(organizationId, orgId)` pattern
 * by catching cross-tenant access attempts at the route level for routes that
 * reference resources by ID in params/body.
 */

import { NotFoundError } from "@ss/shared";
import { and, eq } from "drizzle-orm";
import type { PgTable, PgColumn } from "drizzle-orm/pg-core";

import type { Db } from "../db/index.js";
import {
  apps,
  servers,
  domains,
  deployments,
  envVars,
  inboundWebhooks,
  outboundWebhooks,
  vcsConnections,
  dbBackupConfigs,
  databaseServers,
  databases,
  scheduledJobs,
  metricAlerts,
  notificationChannels,
  dbConnections,
} from "../db/schema/index.js";

export type ResourceType =
  | "app"
  | "server"
  | "domain"
  | "deployment"
  | "envVar"
  | "inboundWebhook"
  | "outboundWebhook"
  | "vcsConnection"
  | "backupConfig"
  | "databaseServer"
  | "database"
  | "scheduledJob"
  | "metricAlert"
  | "notificationChannel"
  | "dbConnection";
// Note: previewEnvironments doesn't have organizationId (linked via appId)

interface TableInfo {
  table: PgTable;
  idColumn: PgColumn;
  orgColumn: PgColumn;
}

const RESOURCE_TABLES: Record<ResourceType, TableInfo> = {
  app: { table: apps, idColumn: apps.id, orgColumn: apps.organizationId },
  server: { table: servers, idColumn: servers.id, orgColumn: servers.organizationId },
  domain: { table: domains, idColumn: domains.id, orgColumn: domains.organizationId },
  deployment: {
    table: deployments,
    idColumn: deployments.id,
    orgColumn: deployments.organizationId,
  },
  envVar: { table: envVars, idColumn: envVars.id, orgColumn: envVars.organizationId },
  inboundWebhook: {
    table: inboundWebhooks,
    idColumn: inboundWebhooks.id,
    orgColumn: inboundWebhooks.organizationId,
  },
  outboundWebhook: {
    table: outboundWebhooks,
    idColumn: outboundWebhooks.id,
    orgColumn: outboundWebhooks.organizationId,
  },
  vcsConnection: {
    table: vcsConnections,
    idColumn: vcsConnections.id,
    orgColumn: vcsConnections.organizationId,
  },
  backupConfig: {
    table: dbBackupConfigs,
    idColumn: dbBackupConfigs.id,
    orgColumn: dbBackupConfigs.organizationId,
  },
  databaseServer: {
    table: databaseServers,
    idColumn: databaseServers.id,
    orgColumn: databaseServers.organizationId,
  },
  database: { table: databases, idColumn: databases.id, orgColumn: databases.organizationId },
  scheduledJob: {
    table: scheduledJobs,
    idColumn: scheduledJobs.id,
    orgColumn: scheduledJobs.organizationId,
  },
  metricAlert: {
    table: metricAlerts,
    idColumn: metricAlerts.id,
    orgColumn: metricAlerts.organizationId,
  },
  notificationChannel: {
    table: notificationChannels,
    idColumn: notificationChannels.id,
    orgColumn: notificationChannels.organizationId,
  },
  dbConnection: {
    table: dbConnections,
    idColumn: dbConnections.id,
    orgColumn: dbConnections.organizationId,
  },
};

/**
 * Validate that a resource belongs to the specified organization.
 * Returns true if the resource exists and belongs to the org, false otherwise.
 * This is a pure function that can be unit-tested.
 */
export async function validateResourceOwnership(
  db: Db,
  resourceType: ResourceType,
  resourceId: string,
  organizationId: string,
): Promise<boolean> {
  const info = RESOURCE_TABLES[resourceType];
  if (!info) return false;

  const rows = await db
    .select({ id: info.idColumn })
    .from(info.table)
    .where(and(eq(info.idColumn, resourceId), eq(info.orgColumn, organizationId)))
    .limit(1);

  return rows.length > 0;
}

/**
 * Assert that a resource belongs to the organization, throwing NotFoundError
 * if not (we return 404, not 403, to avoid leaking existence of cross-tenant
 * resources — the same pattern used in services).
 */
export async function assertResourceInOrg(
  db: Db,
  resourceType: ResourceType,
  resourceId: string,
  organizationId: string,
): Promise<void> {
  const valid = await validateResourceOwnership(db, resourceType, resourceId, organizationId);
  if (!valid) {
    throw new NotFoundError(`${resourceType} not found`);
  }
}

/**
 * Extract resource ID from request params/body based on common patterns.
 * Returns null if the param is not present.
 */
export function extractResourceId(
  params: Record<string, unknown>,
  body: Record<string, unknown> | undefined,
  paramName: string,
): string | null {
  // Check params first (most common: /apps/:id, /servers/:id)
  if (params[paramName] && typeof params[paramName] === "string") {
    return params[paramName] as string;
  }
  // Check body for references (e.g., { serverId: "..." } in create/update)
  if (body && body[paramName] && typeof body[paramName] === "string") {
    return body[paramName] as string;
  }
  return null;
}

/**
 * Map param names to resource types. Used by the middleware to determine
 * which table to check based on the param name.
 */
export const PARAM_TO_RESOURCE: Record<string, ResourceType> = {
  id: "app", // default for :id in /apps routes
  appId: "app",
  serverId: "server",
  domainId: "domain",
  deploymentId: "deployment",
  envVarId: "envVar",
  webhookId: "inboundWebhook",
  outboundWebhookId: "outboundWebhook",
  vcsConnectionId: "vcsConnection",
  backupConfigId: "backupConfig",
  databaseServerId: "databaseServer",
  databaseId: "database",
  scheduleId: "scheduledJob",
  alertId: "metricAlert",
  channelId: "notificationChannel",
  connectionId: "dbConnection",
};
