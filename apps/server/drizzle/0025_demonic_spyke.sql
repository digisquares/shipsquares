CREATE TABLE "update_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"channel" text DEFAULT 'stable' NOT NULL,
	"auto_update" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
