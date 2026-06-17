// Caddy on-demand TLS abuse gate (08-proxy-ssl.md). Caddy calls
// GET /internal/tls/ask?domain= before obtaining a cert for an unknown host; we
// answer 200 only for an fqdn that exists in `domains` and is verified/pending,
// 403 otherwise — preventing cert requests for arbitrary hostnames.

export interface AskResult {
  allow: boolean;
  status: 200 | 403;
}

const ALLOWED_STATUSES = new Set(["verified", "pending"]);

export function answerAsk(
  domain: string,
  statusOf: (fqdn: string) => string | undefined,
): AskResult {
  const status = statusOf(domain);
  const allow = status !== undefined && ALLOWED_STATUSES.has(status);
  return { allow, status: allow ? 200 : 403 };
}

export const ASK_PATH = "/internal/tls/ask";

/** The ask URL Caddy consults — same host, so always loopback. */
export function askEndpointUrl(port: number): string {
  return `http://127.0.0.1:${port}${ASK_PATH}`;
}
