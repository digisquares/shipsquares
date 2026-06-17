CREATE TYPE "public"."accessory_type" AS ENUM('postgres', 'mysql', 'mariadb', 'mongo', 'redis');--> statement-breakpoint
CREATE TYPE "public"."ai_provider" AS ENUM('anthropic');--> statement-breakpoint
CREATE TYPE "public"."build_strategy" AS ENUM('compose', 'dockerfile', 'nixpacks', 'static');--> statement-breakpoint
CREATE TYPE "public"."cert_status" AS ENUM('pending', 'issuing', 'active', 'failed', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."db_backup_status" AS ENUM('running', 'success', 'failed');--> statement-breakpoint
CREATE TYPE "public"."db_backup_target" AS ENUM('object_storage', 'sftp', 'local');--> statement-breakpoint
CREATE TYPE "public"."db_backup_type" AS ENUM('logical', 'physical');--> statement-breakpoint
CREATE TYPE "public"."db_engine" AS ENUM('postgres', 'mysql', 'mariadb');--> statement-breakpoint
CREATE TYPE "public"."db_replica_mode" AS ENUM('streaming', 'logical');--> statement-breakpoint
CREATE TYPE "public"."db_replica_status" AS ENUM('pending', 'streaming', 'broken');--> statement-breakpoint
CREATE TYPE "public"."deployment_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."deployment_trigger" AS ENUM('push', 'manual', 'api', 'mcp', 'schedule', 'rollback');--> statement-breakpoint
CREATE TYPE "public"."log_stream" AS ENUM('stdout', 'stderr', 'system');--> statement-breakpoint
CREATE TYPE "public"."metric_scope" AS ENUM('server', 'app', 'container');--> statement-breakpoint
CREATE TYPE "public"."mount_type" AS ENUM('volume', 'bind', 'file');--> statement-breakpoint
CREATE TYPE "public"."notification_delivery_status" AS ENUM('sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."notification_event" AS ENUM('deploy.succeeded', 'deploy.failed', 'backup.succeeded', 'backup.failed', 'server.threshold', 'scheduled_job.failed', 'app.unhealthy', 'cert.expiring');--> statement-breakpoint
CREATE TYPE "public"."notification_kind" AS ENUM('email', 'slack', 'discord', 'telegram', 'webhook');--> statement-breakpoint
CREATE TYPE "public"."org_role" AS ENUM('owner', 'admin', 'deployer', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."preview_status" AS ENUM('building', 'running', 'closed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."scheduled_job_status" AS ENUM('running', 'success', 'failed');--> statement-breakpoint
CREATE TYPE "public"."scheduled_job_target" AS ENUM('app_container', 'service', 'server');--> statement-breakpoint
CREATE TYPE "public"."server_role" AS ENUM('control', 'worker');--> statement-breakpoint
CREATE TYPE "public"."shared_var_scope" AS ENUM('org', 'app');--> statement-breakpoint
CREATE TYPE "public"."step_status" AS ENUM('pending', 'running', 'succeeded', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."vcs_kind" AS ENUM('github_app', 'oauth', 'manual');--> statement-breakpoint
CREATE TYPE "public"."vcs_provider" AS ENUM('github', 'gitlab', 'gitea', 'bitbucket', 'generic');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"active_organization_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" "org_role" DEFAULT 'viewer' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_org_user_uq" UNIQUE("organization_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"team_id" text NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "team_members_pk" UNIQUE("team_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teams_org_name_uq" UNIQUE("organization_id","name")
);
--> statement-breakpoint
CREATE TABLE "servers" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"host" text NOT NULL,
	"ssh_port" integer DEFAULT 22 NOT NULL,
	"ssh_user" text DEFAULT 'root' NOT NULL,
	"ssh_ref" text,
	"role" "server_role" DEFAULT 'worker' NOT NULL,
	"docker_ok" boolean DEFAULT false NOT NULL,
	"caddy_ok" boolean DEFAULT false NOT NULL,
	"docker_cleanup_enabled" boolean DEFAULT true NOT NULL,
	"docker_cleanup_threshold_pct" integer DEFAULT 80 NOT NULL,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "apps" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"server_id" text,
	"name" text NOT NULL,
	"repo" text,
	"branch" text DEFAULT 'main' NOT NULL,
	"compose_path" text DEFAULT 'docker-compose.yml',
	"service" text,
	"build_strategy" "build_strategy" DEFAULT 'compose' NOT NULL,
	"build_config" jsonb DEFAULT '{"strategy":"compose"}'::jsonb NOT NULL,
	"vcs_connection_id" text,
	"rollback_enabled" boolean DEFAULT true NOT NULL,
	"images_to_keep" integer DEFAULT 5 NOT NULL,
	"cpu_limit" numeric,
	"cpu_reservation" numeric,
	"mem_limit_bytes" bigint,
	"mem_reservation_bytes" bigint,
	"replicas" integer DEFAULT 1 NOT NULL,
	"restart_policy" text DEFAULT 'unless-stopped' NOT NULL,
	"health_check" jsonb,
	"registry_credential_id" text,
	"preview_enabled" boolean DEFAULT false NOT NULL,
	"preview_wildcard_domain" text,
	"preview_limit" integer DEFAULT 5 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "apps_org_name_uq" UNIQUE("organization_id","name")
);
--> statement-breakpoint
CREATE TABLE "domains" (
	"id" text PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"fqdn" text NOT NULL,
	"target_port" integer DEFAULT 3000 NOT NULL,
	"https" boolean DEFAULT true NOT NULL,
	"cert_status" "cert_status" DEFAULT 'pending' NOT NULL,
	"cert_error" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "domains_fqdn_uq" UNIQUE("fqdn")
);
--> statement-breakpoint
CREATE TABLE "env_vars" (
	"id" text PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"key" text NOT NULL,
	"value" text,
	"value_ref" text,
	"is_secret" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "env_vars_app_key_uq" UNIQUE("app_id","key")
);
--> statement-breakpoint
CREATE TABLE "deployment_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"deployment_id" text NOT NULL,
	"step_id" text,
	"seq" integer NOT NULL,
	"stream" "log_stream" DEFAULT 'stdout' NOT NULL,
	"line" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deployment_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"deployment_id" text NOT NULL,
	"ordinal" integer NOT NULL,
	"name" text NOT NULL,
	"status" "step_status" DEFAULT 'pending' NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "deployments" (
	"id" text PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"server_id" text,
	"status" "deployment_status" DEFAULT 'queued' NOT NULL,
	"trigger" "deployment_trigger" NOT NULL,
	"triggered_by" text,
	"api_key_id" text,
	"commit_before" text,
	"commit_after" text,
	"error_message" text,
	"meta" jsonb,
	"log_line_count" integer DEFAULT 0 NOT NULL,
	"log_truncated" boolean DEFAULT false NOT NULL,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "accessories" (
	"id" text PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"type" "accessory_type" NOT NULL,
	"image" text NOT NULL,
	"volume" text,
	"backup_cfg" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "database_servers" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"engine" "db_engine" DEFAULT 'postgres' NOT NULL,
	"host" text NOT NULL,
	"port" integer DEFAULT 5432 NOT NULL,
	"admin_secret_ref" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"tls" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "database_users" (
	"id" text PRIMARY KEY NOT NULL,
	"server_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"username" text NOT NULL,
	"password_secret_ref" text NOT NULL,
	"database_id" text,
	"grants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "databases" (
	"id" text PRIMARY KEY NOT NULL,
	"server_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"owner_role" text NOT NULL,
	"app_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vcs_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"provider" "vcs_provider" NOT NULL,
	"kind" "vcs_kind" NOT NULL,
	"account_login" text NOT NULL,
	"installation_id" text,
	"github_app_id" text,
	"token_secret_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "db_backup_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"server_id" text NOT NULL,
	"database_id" text,
	"type" "db_backup_type" DEFAULT 'logical' NOT NULL,
	"schedule" text NOT NULL,
	"retention_days" integer DEFAULT 14 NOT NULL,
	"target" "db_backup_target" NOT NULL,
	"target_ref" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "db_backups" (
	"id" text PRIMARY KEY NOT NULL,
	"config_id" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" "db_backup_status" DEFAULT 'running' NOT NULL,
	"size_bytes" bigint,
	"location" text,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "db_replicas" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"primary_server_id" text NOT NULL,
	"replica_server_id" text,
	"replica_host" text,
	"mode" "db_replica_mode" DEFAULT 'streaming' NOT NULL,
	"slot_name" text,
	"status" "db_replica_status" DEFAULT 'pending' NOT NULL,
	"lag_bytes" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_basic_auth" (
	"id" text PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"username" text NOT NULL,
	"password_secret_ref" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_mounts" (
	"id" text PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"type" "mount_type" NOT NULL,
	"source" text NOT NULL,
	"target" text NOT NULL,
	"content_secret_ref" text,
	"read_only" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_redirects" (
	"id" text PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"from_pattern" text NOT NULL,
	"to_target" text NOT NULL,
	"permanent" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_certificates" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"domain" text NOT NULL,
	"cert_secret_ref" text NOT NULL,
	"key_secret_ref" text NOT NULL,
	"auto_renew" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "registry_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"registry_url" text NOT NULL,
	"username" text NOT NULL,
	"password_secret_ref" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"provider" "ai_provider" DEFAULT 'anthropic' NOT NULL,
	"model" text DEFAULT 'claude-sonnet-4-6' NOT NULL,
	"api_key_secret_ref" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shared_variables" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"scope" "shared_var_scope" NOT NULL,
	"scope_id" text,
	"key" text NOT NULL,
	"value" text,
	"value_secret_ref" text,
	"is_secret" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_job_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" "scheduled_job_status" DEFAULT 'running' NOT NULL,
	"exit_code" integer,
	"output_tail" text,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "scheduled_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"target" "scheduled_job_target" NOT NULL,
	"app_id" text,
	"server_id" text,
	"name" text NOT NULL,
	"command" text NOT NULL,
	"shell" text DEFAULT 'bash' NOT NULL,
	"cron" text NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_channels" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"kind" "notification_kind" NOT NULL,
	"name" text NOT NULL,
	"config_secret_ref" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"event" text NOT NULL,
	"status" "notification_delivery_status" NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"event" "notification_event" NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "preview_environments" (
	"id" text PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"pr_number" integer NOT NULL,
	"pr_title" text,
	"pr_url" text,
	"branch" text NOT NULL,
	"status" "preview_status" DEFAULT 'building' NOT NULL,
	"domain" text,
	"deployment_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "metric_alerts" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"scope" "metric_scope" NOT NULL,
	"target_id" text NOT NULL,
	"metric" text NOT NULL,
	"threshold_pct" real NOT NULL,
	"window_seconds" integer DEFAULT 300 NOT NULL,
	"channel_id" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metric_samples" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"scope" "metric_scope" NOT NULL,
	"server_id" text,
	"app_id" text,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"cpu_pct" real,
	"mem_bytes" bigint,
	"mem_limit_bytes" bigint,
	"disk_bytes" bigint,
	"net_rx_bytes" bigint,
	"net_tx_bytes" bigint
);
--> statement-breakpoint
CREATE TABLE "docker_cleanup_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"server_id" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"reclaimed_bytes" bigint,
	"status" text DEFAULT 'running' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"auth_api_key_id" text NOT NULL,
	"name" text NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbound_webhooks" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"app_id" text NOT NULL,
	"provider" "vcs_provider" NOT NULL,
	"secret" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbound_webhooks" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"url" text NOT NULL,
	"secret" text,
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text,
	"actor_user_id" text,
	"actor_api_key_id" text,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "servers" ADD CONSTRAINT "servers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apps" ADD CONSTRAINT "apps_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apps" ADD CONSTRAINT "apps_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apps" ADD CONSTRAINT "apps_vcs_connection_id_vcs_connections_id_fk" FOREIGN KEY ("vcs_connection_id") REFERENCES "public"."vcs_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apps" ADD CONSTRAINT "apps_registry_credential_id_registry_credentials_id_fk" FOREIGN KEY ("registry_credential_id") REFERENCES "public"."registry_credentials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domains" ADD CONSTRAINT "domains_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domains" ADD CONSTRAINT "domains_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "env_vars" ADD CONSTRAINT "env_vars_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "env_vars" ADD CONSTRAINT "env_vars_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment_logs" ADD CONSTRAINT "deployment_logs_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment_logs" ADD CONSTRAINT "deployment_logs_step_id_deployment_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."deployment_steps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment_steps" ADD CONSTRAINT "deployment_steps_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_triggered_by_users_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accessories" ADD CONSTRAINT "accessories_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accessories" ADD CONSTRAINT "accessories_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "database_servers" ADD CONSTRAINT "database_servers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "database_users" ADD CONSTRAINT "database_users_server_id_database_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."database_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "database_users" ADD CONSTRAINT "database_users_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "database_users" ADD CONSTRAINT "database_users_database_id_databases_id_fk" FOREIGN KEY ("database_id") REFERENCES "public"."databases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "databases" ADD CONSTRAINT "databases_server_id_database_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."database_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "databases" ADD CONSTRAINT "databases_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "databases" ADD CONSTRAINT "databases_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vcs_connections" ADD CONSTRAINT "vcs_connections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "db_backup_configs" ADD CONSTRAINT "db_backup_configs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "db_backup_configs" ADD CONSTRAINT "db_backup_configs_server_id_database_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."database_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "db_backup_configs" ADD CONSTRAINT "db_backup_configs_database_id_databases_id_fk" FOREIGN KEY ("database_id") REFERENCES "public"."databases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "db_backups" ADD CONSTRAINT "db_backups_config_id_db_backup_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."db_backup_configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "db_replicas" ADD CONSTRAINT "db_replicas_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "db_replicas" ADD CONSTRAINT "db_replicas_primary_server_id_database_servers_id_fk" FOREIGN KEY ("primary_server_id") REFERENCES "public"."database_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "db_replicas" ADD CONSTRAINT "db_replicas_replica_server_id_database_servers_id_fk" FOREIGN KEY ("replica_server_id") REFERENCES "public"."database_servers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_basic_auth" ADD CONSTRAINT "app_basic_auth_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_mounts" ADD CONSTRAINT "app_mounts_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_redirects" ADD CONSTRAINT "app_redirects_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_certificates" ADD CONSTRAINT "custom_certificates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registry_credentials" ADD CONSTRAINT "registry_credentials_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_variables" ADD CONSTRAINT "shared_variables_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_job_runs" ADD CONSTRAINT "scheduled_job_runs_job_id_scheduled_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."scheduled_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_jobs" ADD CONSTRAINT "scheduled_jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_jobs" ADD CONSTRAINT "scheduled_jobs_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_jobs" ADD CONSTRAINT "scheduled_jobs_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_channels" ADD CONSTRAINT "notification_channels_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_channel_id_notification_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."notification_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_subscriptions" ADD CONSTRAINT "notification_subscriptions_channel_id_notification_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."notification_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preview_environments" ADD CONSTRAINT "preview_environments_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preview_environments" ADD CONSTRAINT "preview_environments_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_alerts" ADD CONSTRAINT "metric_alerts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_alerts" ADD CONSTRAINT "metric_alerts_channel_id_notification_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."notification_channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_samples" ADD CONSTRAINT "metric_samples_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_samples" ADD CONSTRAINT "metric_samples_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docker_cleanup_runs" ADD CONSTRAINT "docker_cleanup_runs_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_webhooks" ADD CONSTRAINT "inbound_webhooks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_webhooks" ADD CONSTRAINT "inbound_webhooks_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_webhooks" ADD CONSTRAINT "outbound_webhooks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_api_key_id_api_keys_id_fk" FOREIGN KEY ("actor_api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memberships_org_idx" ON "memberships" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "teams_org_idx" ON "teams" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "servers_org_idx" ON "servers" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "apps_org_idx" ON "apps" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "apps_server_idx" ON "apps" USING btree ("server_id");--> statement-breakpoint
CREATE INDEX "domains_app_idx" ON "domains" USING btree ("app_id");--> statement-breakpoint
CREATE INDEX "domains_org_idx" ON "domains" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "env_vars_app_idx" ON "env_vars" USING btree ("app_id");--> statement-breakpoint
CREATE INDEX "deployment_logs_depl_seq_idx" ON "deployment_logs" USING btree ("deployment_id","seq");--> statement-breakpoint
CREATE INDEX "deployment_steps_depl_idx" ON "deployment_steps" USING btree ("deployment_id","ordinal");--> statement-breakpoint
CREATE INDEX "deployments_app_idx" ON "deployments" USING btree ("app_id");--> statement-breakpoint
CREATE INDEX "deployments_org_status_idx" ON "deployments" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "deployments_app_queued_idx" ON "deployments" USING btree ("app_id","queued_at");--> statement-breakpoint
CREATE INDEX "accessories_app_idx" ON "accessories" USING btree ("app_id");--> statement-breakpoint
CREATE INDEX "database_servers_org_idx" ON "database_servers" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "database_users_server_idx" ON "database_users" USING btree ("server_id");--> statement-breakpoint
CREATE UNIQUE INDEX "database_users_server_name_uq" ON "database_users" USING btree ("server_id","username");--> statement-breakpoint
CREATE INDEX "databases_server_idx" ON "databases" USING btree ("server_id");--> statement-breakpoint
CREATE UNIQUE INDEX "databases_server_name_uq" ON "databases" USING btree ("server_id","name");--> statement-breakpoint
CREATE INDEX "vcs_connections_org_idx" ON "vcs_connections" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "db_backup_configs_server_idx" ON "db_backup_configs" USING btree ("server_id");--> statement-breakpoint
CREATE INDEX "db_backups_config_idx" ON "db_backups" USING btree ("config_id");--> statement-breakpoint
CREATE INDEX "db_replicas_primary_idx" ON "db_replicas" USING btree ("primary_server_id");--> statement-breakpoint
CREATE INDEX "app_basic_auth_app_idx" ON "app_basic_auth" USING btree ("app_id");--> statement-breakpoint
CREATE INDEX "app_mounts_app_idx" ON "app_mounts" USING btree ("app_id");--> statement-breakpoint
CREATE INDEX "app_redirects_app_idx" ON "app_redirects" USING btree ("app_id");--> statement-breakpoint
CREATE INDEX "custom_certificates_org_idx" ON "custom_certificates" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "registry_credentials_org_idx" ON "registry_credentials" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_settings_org_uq" ON "ai_settings" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "shared_variables_scope_idx" ON "shared_variables" USING btree ("organization_id","scope","scope_id");--> statement-breakpoint
CREATE INDEX "scheduled_job_runs_job_idx" ON "scheduled_job_runs" USING btree ("job_id","started_at");--> statement-breakpoint
CREATE INDEX "scheduled_jobs_org_idx" ON "scheduled_jobs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "notification_channels_org_idx" ON "notification_channels" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "notification_deliveries_chan_idx" ON "notification_deliveries" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "notification_subscriptions_chan_idx" ON "notification_subscriptions" USING btree ("channel_id");--> statement-breakpoint
CREATE UNIQUE INDEX "preview_environments_app_pr_uq" ON "preview_environments" USING btree ("app_id","pr_number");--> statement-breakpoint
CREATE INDEX "metric_alerts_org_idx" ON "metric_alerts" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "metric_samples_server_ts_idx" ON "metric_samples" USING btree ("scope","server_id","ts");--> statement-breakpoint
CREATE INDEX "metric_samples_app_ts_idx" ON "metric_samples" USING btree ("scope","app_id","ts");--> statement-breakpoint
CREATE INDEX "docker_cleanup_runs_server_idx" ON "docker_cleanup_runs" USING btree ("server_id");--> statement-breakpoint
CREATE INDEX "api_keys_org_idx" ON "api_keys" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "inbound_webhooks_app_idx" ON "inbound_webhooks" USING btree ("app_id");--> statement-breakpoint
CREATE INDEX "outbound_webhooks_org_idx" ON "outbound_webhooks" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "audit_log_org_idx" ON "audit_log" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "audit_log_created_idx" ON "audit_log" USING btree ("created_at");