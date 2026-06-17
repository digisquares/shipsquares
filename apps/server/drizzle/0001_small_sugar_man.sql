ALTER TABLE "apps" ADD COLUMN "image" text;--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "port" integer DEFAULT 8080 NOT NULL;