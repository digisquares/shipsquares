import { pgEnum } from "drizzle-orm/pg-core";

// Core
export const orgRole = pgEnum("org_role", ["owner", "admin", "deployer", "viewer"]);
export const serverRole = pgEnum("server_role", ["control", "worker"]);
export const serverStatus = pgEnum("server_status", [
  "adding",
  "bootstrapping",
  "ready",
  "error",
  "unreachable",
]);
export const certStatus = pgEnum("cert_status", [
  "pending",
  "issuing",
  "active",
  "failed",
  "disabled",
]);
export const deploymentStatus = pgEnum("deployment_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);
export const deploymentTrigger = pgEnum("deployment_trigger", [
  "push",
  "manual",
  "api",
  "mcp",
  "schedule",
  "rollback",
  "preview",
]);
export const stepStatus = pgEnum("step_status", [
  "pending",
  "running",
  "succeeded",
  "failed",
  "skipped",
]);
export const buildStrategy = pgEnum("build_strategy", [
  "compose",
  "dockerfile",
  "nixpacks",
  "buildpacks",
  "static",
]);
export const accessoryType = pgEnum("accessory_type", [
  "postgres",
  "mysql",
  "mariadb",
  "mongo",
  "redis",
]);
export const vcsProvider = pgEnum("vcs_provider", [
  "github",
  "gitlab",
  "gitea",
  "bitbucket",
  "generic",
]);
export const logStream = pgEnum("log_stream", ["stdout", "stderr", "system"]);

// Databases & provisioning (24)
export const dbEngine = pgEnum("db_engine", ["postgres", "mysql", "mariadb"]);

// VCS connections (26)
export const vcsKind = pgEnum("vcs_kind", ["github_app", "oauth", "manual"]);

// DB backups & replication (27)
export const dbBackupType = pgEnum("db_backup_type", ["logical", "physical"]);
export const dbBackupTarget = pgEnum("db_backup_target", ["object_storage", "sftp", "local"]);
export const dbBackupStatus = pgEnum("db_backup_status", ["running", "success", "failed"]);
export const dbReplicaMode = pgEnum("db_replica_mode", ["streaming", "logical"]);
export const dbReplicaStatus = pgEnum("db_replica_status", ["pending", "streaming", "broken"]);

// App runtime config (06/08/11)
export const mountType = pgEnum("mount_type", ["volume", "bind", "file"]);

// Shared variables & AI settings (11/22)
export const sharedVarScope = pgEnum("shared_var_scope", ["org", "app"]);
export const aiProvider = pgEnum("ai_provider", ["anthropic"]);

// Scheduled jobs (29)
export const scheduledJobTarget = pgEnum("scheduled_job_target", [
  "app_container",
  "service",
  "server",
]);
export const scheduledJobStatus = pgEnum("scheduled_job_status", ["running", "success", "failed"]);

// Notifications (30)
export const notificationKind = pgEnum("notification_kind", [
  "email",
  "slack",
  "discord",
  "telegram",
  "webhook",
]);
export const notificationEvent = pgEnum("notification_event", [
  "deploy.succeeded",
  "deploy.failed",
  "backup.succeeded",
  "backup.failed",
  "server.threshold",
  "scheduled_job.failed",
  "app.unhealthy",
  "cert.expiring",
]);
export const notificationDeliveryStatus = pgEnum("notification_delivery_status", [
  "sent",
  "failed",
]);

// Preview environments (31)
export const previewStatus = pgEnum("preview_status", ["building", "running", "closed", "failed"]);

// Monitoring & metrics (32)
export const metricScope = pgEnum("metric_scope", ["server", "app", "container"]);

// Chatbot conversations (22)
export const messageRole = pgEnum("message_role", ["user", "assistant", "tool"]);

// Member invites (R3.4)
export const inviteStatus = pgEnum("invite_status", ["pending", "accepted", "revoked"]);

// Managed email (R9 · mail/00-index.md). Per-org Stalwart instance + domains.
export const mailInstanceStatus = pgEnum("mail_instance_status", [
  "provisioning",
  "ready",
  "degraded",
  "unreachable",
]);
export const mailStoreBackend = pgEnum("mail_store_backend", ["managed_pg", "filesystem"]);
export const mailEgressStatus = pgEnum("mail_egress_status", ["ok", "blocked", "unknown"]);
export const mailDnsMode = pgEnum("mail_dns_mode", ["auto", "hint"]);
export const mailVerificationStatus = pgEnum("mail_verification_status", [
  "pending",
  "verifying",
  "verified",
  "failed",
]);
export const mailDnsRecordKind = pgEnum("mail_dns_record_kind", [
  "mx",
  "spf",
  "dkim",
  "dmarc",
  "tlsa",
  "mta_sts",
  "tls_rpt",
  "caa",
  "autoconfig",
  "autodiscover",
  "srv",
]);
export const mailboxStatus = pgEnum("mailbox_status", ["active", "suspended", "pending"]);
