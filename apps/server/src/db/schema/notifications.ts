import { bigserial, boolean, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { notificationDeliveryStatus, notificationEvent, notificationKind } from "./enums.js";
import { organizations } from "./organizations.js";

export const notificationChannels = pgTable(
  "notification_channels",
  {
    id: text("id").primaryKey(), // nch_…
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    kind: notificationKind("kind").notNull(),
    name: text("name").notNull(),
    configSecretRef: text("config_secret_ref").notNull(), // creds/token/url → secret store (11)
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ orgIdx: index("notification_channels_org_idx").on(t.organizationId) }),
);

export const notificationSubscriptions = pgTable(
  "notification_subscriptions",
  {
    id: text("id").primaryKey(), // nsub_…
    channelId: text("channel_id")
      .notNull()
      .references(() => notificationChannels.id, { onDelete: "cascade" }),
    event: notificationEvent("event").notNull(),
    enabled: boolean("enabled").notNull().default(true),
  },
  (t) => ({ chanIdx: index("notification_subscriptions_chan_idx").on(t.channelId) }),
);

export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    channelId: text("channel_id")
      .notNull()
      .references(() => notificationChannels.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    status: notificationDeliveryStatus("status").notNull(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ chanIdx: index("notification_deliveries_chan_idx").on(t.channelId) }),
);
