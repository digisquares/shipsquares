import { signOutbound } from "./sign.js";

// Outbound platform webhooks (10-webhooks-vcs.md): machine-consumable event
// deliveries — {event, data} JSON, an X-ShipSquares-Delivery id, and an
// HMAC-SHA256 signature over the exact body when the hook has a secret
// (verify with webhooks/sign.ts verifyOutbound). The dispatcher
// (services/outbound-webhooks.service.ts) owns SSRF guarding + delivery rows.

/** Event names an outbound webhook can subscribe to ("*" = everything).
 *  Mirrors the notification_event enum (30) — one platform event vocabulary. */
export const PLATFORM_EVENTS = [
  "deploy.succeeded",
  "deploy.failed",
  "backup.succeeded",
  "backup.failed",
  "server.threshold",
  "scheduled_job.failed",
  "app.unhealthy",
  "cert.expiring",
] as const;

export interface OutboundDelivery {
  body: string;
  headers: Record<string, string>;
}

export function buildOutboundDelivery(
  event: string,
  data: Record<string, unknown>,
  opts: { deliveryId: string; secret?: string | null },
): OutboundDelivery {
  const body = JSON.stringify({ event, data });
  return {
    body,
    headers: {
      "content-type": "application/json",
      "user-agent": "shipsquares-hooks/1.0",
      "x-shipsquares-event": event,
      "x-shipsquares-delivery": opts.deliveryId,
      ...(opts.secret ? { "x-shipsquares-signature": signOutbound(body, opts.secret) } : {}),
    },
  };
}

export function matchesEvent(subscribed: string[], event: string): boolean {
  return subscribed.includes("*") || subscribed.includes(event);
}
