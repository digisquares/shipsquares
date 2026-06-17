ALTER TABLE "apps" ADD COLUMN "git_poll_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "inbound_webhooks" ADD COLUMN "remote_id" text;