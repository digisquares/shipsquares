import { type WebhookSpec } from "./types.js";

// Build the push-webhook spec to register on a provider (26-vcs-connections.md).
// The ingest URL targets the implemented inbound route `/hooks/:id` (routes/
// hooks.ts) — the provider + secret are resolved from the stored inbound_webhooks
// row by `10`, so the id alone is the path (a deviation from the plan's older
// `/hooks/<provider>/<id>` shape). Pure.

export function buildWebhookSpec(
  controlBaseUrl: string,
  webhookId: string,
  secret: string,
): WebhookSpec {
  const base = controlBaseUrl.replace(/\/+$/, "");
  return { ingestUrl: `${base}/hooks/${webhookId}`, secret, events: ["push"] };
}
