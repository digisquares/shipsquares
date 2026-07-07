import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { vcsKind, vcsProvider } from "./enums.js";
import { organizations } from "./organizations.js";

// How an org's git provider is connected (26-vcs-connections.md). Tokens are
// references into the secret store (11). apps.vcs_connection_id selects one.
export const vcsConnections = pgTable(
  "vcs_connections",
  {
    id: text("id").primaryKey(), // vcs_…
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    provider: vcsProvider("provider").notNull(),
    kind: vcsKind("kind").notNull(),
    accountLogin: text("account_login").notNull(),
    installationId: text("installation_id"),
    githubAppId: text("github_app_id"),
    tokenSecretRef: text("token_secret_ref"), // → secret store (11): App key / OAuth token
    // Manifest-created Apps: reference the org's single sealed key in
    // vcs_app_registrations instead of re-sealing a per-connection copy
    // (R2.7). tokenSecretRef stays the source for the env-app / oauth / manual
    // paths. Cascade so deleting the App removes its now-keyless connections.
    appRegistrationId: text("app_registration_id").references(() => vcsAppRegistrations.id, {
      onDelete: "cascade",
    }),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }), // oauth: refresh-before-expiry (26)
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgIdx: index("vcs_connections_org_idx").on(t.organizationId),
    // Install-callback idempotency: one connection per (org, installation).
    orgInstallation: uniqueIndex("vcs_connections_org_installation")
      .on(t.organizationId, t.installationId)
      .where(sql`installation_id IS NOT NULL`),
    // S11: the install callback's installation_id is client-chosen and enumerable —
    // one GitHub installation must never be bound by two orgs (the second would gain
    // installation-token access to the first's private repos). First bind wins;
    // scoped by App id. Backstops the service-level check against concurrent callbacks.
    appInstallation: uniqueIndex("vcs_connections_app_installation")
      .on(t.githubAppId, t.installationId)
      .where(sql`installation_id IS NOT NULL AND github_app_id IS NOT NULL`),
  }),
);

// A GitHub App an org CREATED via the manifest flow (26-vcs-connections.md):
// the app-level identity + credentials, distinct from a per-installation
// vcs_connection. Lets orgs self-serve the App instead of an operator
// hand-creating it + setting GITHUB_APP_* env. The App id is globally unique on
// GitHub, so the install redirect/token path resolves the org's App by it; the
// app-level webhook resolves the secret by it. Secrets (private key, client
// secret, webhook secret) live sealed in credentialsSecretRef (11).
export const vcsAppRegistrations = pgTable(
  "vcs_app_registrations",
  {
    id: text("id").primaryKey(), // vca_…
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    provider: vcsProvider("provider").notNull().default("github"),
    appId: text("app_id").notNull(),
    slug: text("slug").notNull(), // drives the install redirect URL
    name: text("name").notNull(),
    htmlUrl: text("html_url"),
    credentialsSecretRef: text("credentials_secret_ref").notNull(), // sealed JSON {privateKey,clientId,clientSecret,webhookSecret}
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgIdx: index("vcs_app_registrations_org_idx").on(t.organizationId),
    appIdUnique: uniqueIndex("vcs_app_registrations_app_id").on(t.appId),
  }),
);
