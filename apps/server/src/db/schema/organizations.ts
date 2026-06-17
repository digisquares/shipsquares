import { index, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";

import { users } from "./auth.js";
import { orgRole } from "./enums.js";

export const organizations = pgTable("organizations", {
  id: text("id").primaryKey(), // org_…, == better-auth org id
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const teams = pgTable(
  "teams",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgIdx: index("teams_org_idx").on(t.organizationId),
    orgNameUq: unique("teams_org_name_uq").on(t.organizationId, t.name),
  }),
);

export const teamMembers = pgTable(
  "team_members",
  {
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => ({ pk: unique("team_members_pk").on(t.teamId, t.userId) }),
);

// user × org × role — the RBAC anchor (05-auth-rbac.md).
export const memberships = pgTable(
  "memberships",
  {
    id: text("id").primaryKey(), // mbr_…
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: orgRole("role").notNull().default("viewer"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uq: unique("memberships_org_user_uq").on(t.organizationId, t.userId),
    orgIdx: index("memberships_org_idx").on(t.organizationId),
    userIdx: index("memberships_user_idx").on(t.userId),
  }),
);
