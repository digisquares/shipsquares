CREATE TABLE "outbound_webhook_deliveries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"webhook_id" text NOT NULL,
	"delivery_id" text NOT NULL,
	"event" text NOT NULL,
	"status" "notification_delivery_status" NOT NULL,
	"http_status" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "outbound_webhook_deliveries" ADD CONSTRAINT "outbound_webhook_deliveries_webhook_id_outbound_webhooks_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."outbound_webhooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outbound_webhook_deliveries_wh_idx" ON "outbound_webhook_deliveries" USING btree ("webhook_id","created_at");