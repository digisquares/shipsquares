import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { inviteStatus, orgRole } from "./enums.js";
import { organizations } from "./organizations.js";

// Pending member invites (R3.4): an emailed, expiring, single-use capability
// to join an org at a pre-assigned role. Only the token's sha256 hash is
// stored; acceptance creates the membership.
export const orgInvites = pgTable(
  "org_invites",
  {
    id: text("id").primaryKey(), // inv_…
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: orgRole("role").notNull().default("viewer"),
    tokenHash: text("token_hash").notNull(),
    status: inviteStatus("status").notNull().default("pending"),
    invitedByUserId: text("invited_by_user_id"),
    acceptedByUserId: text("accepted_by_user_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgIdx: index("org_invites_org_idx").on(t.organizationId, t.status),
    tokenIdx: index("org_invites_token_idx").on(t.tokenHash),
  }),
);
