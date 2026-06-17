ALTER TYPE "public"."deployment_trigger" ADD VALUE 'preview';--> statement-breakpoint
ALTER TABLE "api_keys" ALTER COLUMN "auth_api_key_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "key_hash" text NOT NULL;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash");