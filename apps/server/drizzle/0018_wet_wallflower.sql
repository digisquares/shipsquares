CREATE TABLE "vcs_app_registrations" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"provider" "vcs_provider" DEFAULT 'github' NOT NULL,
	"app_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"html_url" text,
	"credentials_secret_ref" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vcs_app_registrations" ADD CONSTRAINT "vcs_app_registrations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vcs_app_registrations_org_idx" ON "vcs_app_registrations" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vcs_app_registrations_app_id" ON "vcs_app_registrations" USING btree ("app_id");