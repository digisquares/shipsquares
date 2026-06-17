import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Singleton row (id = "singleton") holding the result of the latest update check
// (auto-update.md). Instance-level, NOT org-scoped — it describes the whole control
// plane. The update-check cron upserts it; the dashboard reads it for the notify
// badge + the Settings → Updates panel.
export const updateState = pgTable("update_state", {
  id: text("id").primaryKey(),
  currentVersion: text("current_version").notNull(),
  latestVersion: text("latest_version"),
  channel: text("channel").notNull().default("stable"),
  updateAvailable: boolean("update_available").notNull().default(false),
  notesUrl: text("notes_url"),
  releasedAt: timestamp("released_at", { withTimezone: true }),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  lastError: text("last_error"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Singleton operator intent (auto-update.md · Phase 3): which channel to track and
// whether to auto-apply. Distinct from update_state (which is the volatile check
// result). Auto-update defaults OFF — opt-in only.
export const updateSettings = pgTable("update_settings", {
  id: text("id").primaryKey(),
  channel: text("channel").notNull().default("stable"),
  autoUpdate: boolean("auto_update").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
