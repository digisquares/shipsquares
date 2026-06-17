import { relations } from "drizzle-orm";

import { accessories } from "./accessories.js";
import { appMounts } from "./app-runtime.js";
import { apps } from "./apps.js";
import { users } from "./auth.js";
import { deploymentLogs, deploymentSteps, deployments } from "./deployments.js";
import { domains } from "./domains.js";
import { envVars } from "./env-vars.js";
import { memberships, organizations } from "./organizations.js";
import { servers } from "./servers.js";
import { vcsConnections } from "./vcs.js";

export const organizationsRelations = relations(organizations, ({ many }) => ({
  servers: many(servers),
  apps: many(apps),
  memberships: many(memberships),
  deployments: many(deployments),
}));

export const membershipsRelations = relations(memberships, ({ one }) => ({
  organization: one(organizations, {
    fields: [memberships.organizationId],
    references: [organizations.id],
  }),
  user: one(users, { fields: [memberships.userId], references: [users.id] }),
}));

export const serversRelations = relations(servers, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [servers.organizationId],
    references: [organizations.id],
  }),
  apps: many(apps),
}));

export const appsRelations = relations(apps, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [apps.organizationId],
    references: [organizations.id],
  }),
  server: one(servers, { fields: [apps.serverId], references: [servers.id] }),
  vcsConnection: one(vcsConnections, {
    fields: [apps.vcsConnectionId],
    references: [vcsConnections.id],
  }),
  domains: many(domains),
  envVars: many(envVars),
  deployments: many(deployments),
  accessories: many(accessories),
  mounts: many(appMounts),
}));

export const deploymentsRelations = relations(deployments, ({ one, many }) => ({
  app: one(apps, { fields: [deployments.appId], references: [apps.id] }),
  organization: one(organizations, {
    fields: [deployments.organizationId],
    references: [organizations.id],
  }),
  steps: many(deploymentSteps),
  logs: many(deploymentLogs),
}));

export const deploymentStepsRelations = relations(deploymentSteps, ({ one }) => ({
  deployment: one(deployments, {
    fields: [deploymentSteps.deploymentId],
    references: [deployments.id],
  }),
}));

export const deploymentLogsRelations = relations(deploymentLogs, ({ one }) => ({
  deployment: one(deployments, {
    fields: [deploymentLogs.deploymentId],
    references: [deployments.id],
  }),
  step: one(deploymentSteps, {
    fields: [deploymentLogs.stepId],
    references: [deploymentSteps.id],
  }),
}));

export const domainsRelations = relations(domains, ({ one }) => ({
  app: one(apps, { fields: [domains.appId], references: [apps.id] }),
}));
