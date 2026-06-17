import { createHmac, timingSafeEqual } from "node:crypto";

// Outbound webhook signing (10-webhooks-vcs.md): subscribers verify
// X-ShipSquares-Signature = `sha256=` + HMAC-SHA256(secret, body).

export function signOutbound(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

export function verifyOutbound(body: string, signature: string, secret: string): boolean {
  const expected = signOutbound(body, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
