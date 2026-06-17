-- One-time dedupe so the unique index can build: keep the newest connection per
-- (org, installation) — duplicates could exist from pre-idempotency callbacks.
DELETE FROM "vcs_connections" a
USING "vcs_connections" b
WHERE a."organization_id" = b."organization_id"
  AND a."installation_id" = b."installation_id"
  AND a."installation_id" IS NOT NULL
  AND (a."created_at" < b."created_at" OR (a."created_at" = b."created_at" AND a."id" < b."id"));--> statement-breakpoint
CREATE UNIQUE INDEX "vcs_connections_org_installation" ON "vcs_connections" USING btree ("organization_id","installation_id") WHERE installation_id IS NOT NULL;