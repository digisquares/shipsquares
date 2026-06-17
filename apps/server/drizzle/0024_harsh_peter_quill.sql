CREATE TABLE "update_state" (
	"id" text PRIMARY KEY NOT NULL,
	"current_version" text NOT NULL,
	"latest_version" text,
	"channel" text DEFAULT 'stable' NOT NULL,
	"update_available" boolean DEFAULT false NOT NULL,
	"notes_url" text,
	"released_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
