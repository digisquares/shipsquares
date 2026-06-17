import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { catalogServices } from "./catalog-services.js";
import {
  mailDnsMode,
  mailDnsRecordKind,
  mailEgressStatus,
  mailInstanceStatus,
  mailStoreBackend,
  mailVerificationStatus,
  mailboxStatus,
} from "./enums.js";
import { organizations } from "./organizations.js";
import { servers } from "./servers.js";

// Managed email (R9 · mail/00-index.md, mail/02-data-model.md). Stalwart is the
// source of truth for the mail directory; these rows hold *intent* + durable
// verify/health state, reconciled by a job. Per-org single-tenant instance.

// One Stalwart instance per org, bound to the catalog_services install that runs
// it and to a mail-capable host (port 25 + PTR). Mailbox passwords are never
// stored — set directly in Stalwart, shown once (mail/04). Only the admin token,
// relay creds, and DNS-provider token are sealed refs.
export const mailInstances = pgTable(
  "mail_instances",
  {
    id: text("id").primaryKey(), // mli_…
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    catalogServiceId: text("catalog_service_id")
      .notNull()
      .references(() => catalogServices.id, { onDelete: "cascade" }),
    serverId: text("server_id")
      .notNull()
      .references(() => servers.id),
    hostname: text("hostname").notNull(), // the MX FQDN (PTR must match)
    adminSecretRef: text("admin_secret_ref").notNull(), // sealed Stalwart admin token / OAuth client
    relaySecretRef: text("relay_secret_ref"), // sealed smarthost creds (R(mail).3)
    storeBackend: mailStoreBackend("store_backend").notNull().default("filesystem"),
    metadataDbId: text("metadata_db_id"), // → databases.id when store_backend=managed_pg (FK deferred)
    status: mailInstanceStatus("status").notNull().default("provisioning"),
    port25Egress: mailEgressStatus("port25_egress").notNull().default("unknown"),
    ptrOk: boolean("ptr_ok"), // rDNS matches hostname (null = not checked)
    lastHealthAt: timestamp("last_health_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ orgIdx: index("mail_instances_org_idx").on(t.organizationId) }),
);

// A sending/receiving domain hosted in an instance. org_id is denormalized for
// the resource-scope preHandler (R3.5).
export const mailDomains = pgTable(
  "mail_domains",
  {
    id: text("id").primaryKey(), // mld_…
    mailInstanceId: text("mail_instance_id")
      .notNull()
      .references(() => mailInstances.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    fqdn: text("fqdn").notNull(),
    dkimSelector: text("dkim_selector").notNull(),
    dnsMode: mailDnsMode("dns_mode").notNull().default("hint"),
    dnsProviderRef: text("dns_provider_ref"), // sealed provider creds (auto mode)
    verificationStatus: mailVerificationStatus("verification_status").notNull().default("pending"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    inboxSubdomain: text("inbox_subdomain").notNull(), // Caddy route key (e.g. inbox.acme.com)
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    instanceIdx: index("mail_domains_instance_idx").on(t.mailInstanceId),
    orgIdx: index("mail_domains_org_idx").on(t.organizationId),
    fqdnUniq: uniqueIndex("mail_domains_instance_fqdn_uniq").on(t.mailInstanceId, t.fqdn),
  }),
);

// Per-record verification state — so the UI can badge each record and the verify
// job can advance them independently. Auto-mode rows still verify (confirm the
// published value resolves).
export const mailDnsRecords = pgTable(
  "mail_dns_records",
  {
    id: text("id").primaryKey(), // mdr_…
    mailDomainId: text("mail_domain_id")
      .notNull()
      .references(() => mailDomains.id, { onDelete: "cascade" }),
    kind: mailDnsRecordKind("kind").notNull(),
    name: text("name").notNull(), // record host/name
    type: text("type").notNull(), // MX · TXT · CNAME · SRV · …
    value: text("value").notNull(), // expected value (from Stalwart)
    priority: integer("priority"), // for MX/SRV
    status: mailVerificationStatus("status").notNull().default("pending"),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    detail: text("detail"), // mismatch explanation for the UI
  },
  (t) => ({ domainIdx: index("mail_dns_records_domain_idx").on(t.mailDomainId) }),
);

// Thin mirror of a Stalwart account. No password column by design (mail/02, /04).
export const mailboxes = pgTable(
  "mailboxes",
  {
    id: text("id").primaryKey(), // mbx_…
    mailDomainId: text("mail_domain_id")
      .notNull()
      .references(() => mailDomains.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    localPart: text("local_part").notNull(), // alice in alice@acme.com
    displayName: text("display_name"),
    quotaBytes: bigint("quota_bytes", { mode: "number" }), // null = unlimited
    status: mailboxStatus("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    domainIdx: index("mailboxes_domain_idx").on(t.mailDomainId),
    localUniq: uniqueIndex("mailboxes_domain_local_uniq").on(t.mailDomainId, t.localPart),
  }),
);

export const mailAliases = pgTable(
  "mail_aliases",
  {
    id: text("id").primaryKey(), // mal_…
    mailDomainId: text("mail_domain_id")
      .notNull()
      .references(() => mailDomains.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    alias: text("alias").notNull(), // left-hand side
    destinations: jsonb("destinations").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    domainIdx: index("mail_aliases_domain_idx").on(t.mailDomainId),
    aliasUniq: uniqueIndex("mail_aliases_domain_alias_uniq").on(t.mailDomainId, t.alias),
  }),
);
