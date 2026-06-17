CREATE TYPE "public"."mail_dns_mode" AS ENUM('auto', 'hint');--> statement-breakpoint
CREATE TYPE "public"."mail_dns_record_kind" AS ENUM('mx', 'spf', 'dkim', 'dmarc', 'tlsa', 'mta_sts', 'tls_rpt', 'caa', 'autoconfig', 'autodiscover', 'srv');--> statement-breakpoint
CREATE TYPE "public"."mail_egress_status" AS ENUM('ok', 'blocked', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."mail_instance_status" AS ENUM('provisioning', 'ready', 'degraded', 'unreachable');--> statement-breakpoint
CREATE TYPE "public"."mail_store_backend" AS ENUM('managed_pg', 'filesystem');--> statement-breakpoint
CREATE TYPE "public"."mail_verification_status" AS ENUM('pending', 'verifying', 'verified', 'failed');--> statement-breakpoint
CREATE TYPE "public"."mailbox_status" AS ENUM('active', 'suspended', 'pending');--> statement-breakpoint
CREATE TABLE "mail_aliases" (
	"id" text PRIMARY KEY NOT NULL,
	"mail_domain_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"alias" text NOT NULL,
	"destinations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail_dns_records" (
	"id" text PRIMARY KEY NOT NULL,
	"mail_domain_id" text NOT NULL,
	"kind" "mail_dns_record_kind" NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"value" text NOT NULL,
	"priority" integer,
	"status" "mail_verification_status" DEFAULT 'pending' NOT NULL,
	"last_checked_at" timestamp with time zone,
	"detail" text
);
--> statement-breakpoint
CREATE TABLE "mail_domains" (
	"id" text PRIMARY KEY NOT NULL,
	"mail_instance_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"fqdn" text NOT NULL,
	"dkim_selector" text NOT NULL,
	"dns_mode" "mail_dns_mode" DEFAULT 'hint' NOT NULL,
	"dns_provider_ref" text,
	"verification_status" "mail_verification_status" DEFAULT 'pending' NOT NULL,
	"verified_at" timestamp with time zone,
	"inbox_subdomain" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail_instances" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"catalog_service_id" text NOT NULL,
	"server_id" text NOT NULL,
	"hostname" text NOT NULL,
	"admin_secret_ref" text NOT NULL,
	"relay_secret_ref" text,
	"store_backend" "mail_store_backend" DEFAULT 'filesystem' NOT NULL,
	"metadata_db_id" text,
	"status" "mail_instance_status" DEFAULT 'provisioning' NOT NULL,
	"port25_egress" "mail_egress_status" DEFAULT 'unknown' NOT NULL,
	"ptr_ok" boolean,
	"last_health_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mailboxes" (
	"id" text PRIMARY KEY NOT NULL,
	"mail_domain_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"local_part" text NOT NULL,
	"display_name" text,
	"quota_bytes" bigint,
	"status" "mailbox_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mail_aliases" ADD CONSTRAINT "mail_aliases_mail_domain_id_mail_domains_id_fk" FOREIGN KEY ("mail_domain_id") REFERENCES "public"."mail_domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_aliases" ADD CONSTRAINT "mail_aliases_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_dns_records" ADD CONSTRAINT "mail_dns_records_mail_domain_id_mail_domains_id_fk" FOREIGN KEY ("mail_domain_id") REFERENCES "public"."mail_domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_domains" ADD CONSTRAINT "mail_domains_mail_instance_id_mail_instances_id_fk" FOREIGN KEY ("mail_instance_id") REFERENCES "public"."mail_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_domains" ADD CONSTRAINT "mail_domains_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_instances" ADD CONSTRAINT "mail_instances_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_instances" ADD CONSTRAINT "mail_instances_catalog_service_id_catalog_services_id_fk" FOREIGN KEY ("catalog_service_id") REFERENCES "public"."catalog_services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_instances" ADD CONSTRAINT "mail_instances_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD CONSTRAINT "mailboxes_mail_domain_id_mail_domains_id_fk" FOREIGN KEY ("mail_domain_id") REFERENCES "public"."mail_domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD CONSTRAINT "mailboxes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mail_aliases_domain_idx" ON "mail_aliases" USING btree ("mail_domain_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_aliases_domain_alias_uniq" ON "mail_aliases" USING btree ("mail_domain_id","alias");--> statement-breakpoint
CREATE INDEX "mail_dns_records_domain_idx" ON "mail_dns_records" USING btree ("mail_domain_id");--> statement-breakpoint
CREATE INDEX "mail_domains_instance_idx" ON "mail_domains" USING btree ("mail_instance_id");--> statement-breakpoint
CREATE INDEX "mail_domains_org_idx" ON "mail_domains" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_domains_instance_fqdn_uniq" ON "mail_domains" USING btree ("mail_instance_id","fqdn");--> statement-breakpoint
CREATE INDEX "mail_instances_org_idx" ON "mail_instances" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "mailboxes_domain_idx" ON "mailboxes" USING btree ("mail_domain_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mailboxes_domain_local_uniq" ON "mailboxes" USING btree ("mail_domain_id","local_part");