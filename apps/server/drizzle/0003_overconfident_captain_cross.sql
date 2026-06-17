-- One-time cleanup so the partial unique index can build: migrations run while
-- the control plane is stopped, so any still-queued/running row is stale (its
-- owning process is gone).
UPDATE "deployments"
SET "status" = 'failed',
    "error_message" = COALESCE("error_message", 'stale: control plane restarted mid-deploy'),
    "finished_at" = COALESCE("finished_at", now())
WHERE "status" IN ('queued', 'running');--> statement-breakpoint
CREATE UNIQUE INDEX "deployments_one_active_per_app" ON "deployments" USING btree ("app_id") WHERE status IN ('queued', 'running');