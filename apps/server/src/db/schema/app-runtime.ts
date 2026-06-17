import { boolean, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { apps } from "./apps.js";
import { mountType } from "./enums.js";
import { organizations } from "./organizations.js";

// Private image pull credentials (11). apps.registry_credential_id selects one.
export const registryCredentials = pgTable(
  "registry_credentials",
  {
    id: text("id").primaryKey(), // reg_…
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    registryUrl: text("registry_url").notNull(),
    username: text("username").notNull(),
    passwordSecretRef: text("password_secret_ref").notNull(), // → secret store (11)
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ orgIdx: index("registry_credentials_org_idx").on(t.organizationId) }),
);

export const appMounts = pgTable(
  "app_mounts",
  {
    id: text("id").primaryKey(), // mnt_…
    appId: text("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    type: mountType("type").notNull(),
    source: text("source").notNull(), // volume name / host path / '' for file mounts
    target: text("target").notNull(), // path inside the container
    contentSecretRef: text("content_secret_ref"), // 'file' mounts: inline content via secret store (11)
    readOnly: boolean("read_only").notNull().default(false),
  },
  (t) => ({ appIdx: index("app_mounts_app_idx").on(t.appId) }),
);

export const appRedirects = pgTable(
  "app_redirects",
  {
    id: text("id").primaryKey(), // rdr_…
    appId: text("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    fromPattern: text("from_pattern").notNull(),
    toTarget: text("to_target").notNull(),
    permanent: boolean("permanent").notNull().default(true),
  },
  (t) => ({ appIdx: index("app_redirects_app_idx").on(t.appId) }),
);

export const appBasicAuth = pgTable(
  "app_basic_auth",
  {
    id: text("id").primaryKey(), // bau_…
    appId: text("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    username: text("username").notNull(),
    passwordSecretRef: text("password_secret_ref").notNull(), // → secret store (11)
  },
  (t) => ({ appIdx: index("app_basic_auth_app_idx").on(t.appId) }),
);

export const customCertificates = pgTable(
  "custom_certificates",
  {
    id: text("id").primaryKey(), // crt_…
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    domain: text("domain").notNull(),
    certSecretRef: text("cert_secret_ref").notNull(), // → secret store (11)
    keySecretRef: text("key_secret_ref").notNull(),
    autoRenew: boolean("auto_renew").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ orgIdx: index("custom_certificates_org_idx").on(t.organizationId) }),
);
