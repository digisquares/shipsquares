CREATE TYPE "public"."server_status" AS ENUM('adding', 'bootstrapping', 'ready', 'error', 'unreachable');--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "status" "server_status" DEFAULT 'adding' NOT NULL;--> statement-breakpoint
UPDATE "servers" SET "status" = 'ready' WHERE "docker_ok" = true;
