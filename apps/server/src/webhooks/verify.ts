import { createHmac, timingSafeEqual } from "node:crypto";

// Signature verification — runs on the RAW body BEFORE any JSON parse (parsing
// untrusted input pre-verification is a footgun). All compares are constant-time
// with a length guard (timingSafeEqual throws on unequal length).

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** GitHub: X-Hub-Signature-256 = `sha256=` + HMAC-SHA256(secret, rawBody). */
export function githubVerify(
  rawBody: Buffer | string,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  return safeEqual(signatureHeader ?? "", expected);
}

/** Gitea: X-Gitea-Signature = HMAC-SHA256(secret, rawBody) hex (no `sha256=` prefix). */
export function giteaVerify(
  rawBody: Buffer | string,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  return safeEqual(signatureHeader ?? "", expected);
}

/** GitLab: X-Gitlab-Token constant-time equals the stored secret. */
export function gitlabVerify(tokenHeader: string | undefined, secret: string): boolean {
  return safeEqual(tokenHeader ?? "", secret);
}

/** Bitbucket: no HMAC — verify the secret path token (optionally + IP allowlist). */
export function bitbucketVerify(pathToken: string | undefined, secret: string): boolean {
  return safeEqual(pathToken ?? "", secret);
}
