ALTER TABLE "db_backup_configs" ADD COLUMN "keep_newest" integer DEFAULT 14 NOT NULL;--> statement-breakpoint
UPDATE "db_backup_configs" SET "keep_newest" = "retention_days";
