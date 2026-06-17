import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { apps } from "./apps.js";
import { notificationDeliveryStatus, vcsProvider } from "./enums.js";
import { organizations } from "./organizations.js";

export const inboundWebhooks = pgTable(
  "inbound_webhooks",
  {
    id: text("id").primaryKey(), // whk_…
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    appId: text("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    provider: vcsProvider("provider").notNull(),
    secret: text("secret").notNull(), // HMAC signing secret (encrypted at rest)
    remoteId: text("remote_id"), // provider-side hook id (for targeted removal, R2.2)
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ appIdx: index("inbound_webhooks_app_idx").on(t.appId) }),
);

export const outboundWebhooks = pgTable(
  "outbound_webhooks",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    secret: text("secret"), // optional HMAC signing secret, sealed at rest (11)
    events: jsonb("events").$type<string[]>().notNull().default([]),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ orgIdx: index("outbound_webhooks_org_idx").on(t.organizationId) }),
);

// One row per delivery attempt (10): what fired, where it landed, how it went.
export const outboundWebhookDeliveries = pgTable(
  "outbound_webhook_deliveries",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    webhookId: text("webhook_id")
      .notNull()
      .references(() => outboundWebhooks.id, { onDelete: "cascade" }),
    deliveryId: text("delivery_id").notNull(), // the X-ShipSquares-Delivery header value
    event: text("event").notNull(),
    status: notificationDeliveryStatus("status").notNull(),
    httpStatus: integer("http_status"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ whIdx: index("outbound_webhook_deliveries_wh_idx").on(t.webhookId, t.createdAt) }),
);
