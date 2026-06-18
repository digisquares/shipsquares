CREATE TABLE "ai_memories" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"key" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_memories" ADD CONSTRAINT "ai_memories_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_memories_org_key_uq" ON "ai_memories" USING btree ("organization_id","key");