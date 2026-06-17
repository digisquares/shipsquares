ALTER TABLE "db_backup_configs" ADD COLUMN "wal_archive" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "db_backup_configs" ADD COLUMN "slot_name" text;--> statement-breakpoint
ALTER TABLE "db_backup_configs" ADD COLUMN "wal_schedule" text;--> statement-breakpoint
ALTER TABLE "db_backup_configs" ADD COLUMN "last_wal_lsn" text;--> statement-breakpoint
ALTER TABLE "db_backup_configs" ADD COLUMN "last_wal_at" timestamp with time zone;