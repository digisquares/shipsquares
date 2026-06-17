// GitHub App **manifest** creation flow (26-vcs-connections.md). Lets an org
// admin create the ShipSquares GitHub App in one click instead of hand-creating
// it and setting GITHUB_APP_* env vars (the Coolify/Dokploy pattern). The
// browser POSTs `buildGithubAppManifest(...)` to `manifestPostUrl(...)`; GitHub
// redirects back with a temporary `?code=` which `exchangeManifestCode` trades
// at POST /app-manifests/{code}/conversions for the app's id/slug/keys. Pure +
// injected-fetch so the network boundary is unit-testable.

/** GitHub App manifest payload (the subset we set). `hook_attributes` points at
 *  the app-level webhook (`/hooks/github/app`): one webhook for the whole App
 *  delivering push + pull_request for every installed repo, so no per-repo hook
 *  registration is needed and PR previews fire automatically (R2.7). */
export interface GithubAppManifest {
  name: string;
  url: string;
  hook_attributes: { url: string; active: boolean };
  redirect_url: string;
  callback_urls: string[];
  public: boolean;
  request_oauth_on_install: boolean;
  default_permissions: Record<string, string>;
  default_events: string[];
}

export interface ManifestOptions {
  /** Display name of the App to create (must be globally unique on GitHub). */
  name: string;
  /** Control-plane base URL (AUTH_URL), e.g. https://cp.example.com. */
  baseUrl: string;
  callbackPath?: string;
  webhookPath?: string;
}

const DEFAULT_CALLBACK = "/vcs/github/app/manifest/callback";
const DEFAULT_WEBHOOK = "/hooks/github/app";

/** Build the manifest. Permissions/events cover deploy (contents/metadata),
 *  branch listing, and PR previews + comments (pull_requests:write). */
export function buildGithubAppManifest(o: ManifestOptions): GithubAppManifest {
  const base = o.baseUrl.replace(/\/+$/, "");
  const callback = `${base}${o.callbackPath ?? DEFAULT_CALLBACK}`;
  return {
    name: o.name,
    url: base,
    hook_attributes: { url: `${base}${o.webhookPath ?? DEFAULT_WEBHOOK}`, active: true },
    redirect_url: callback,
    callback_urls: [callback],
    public: false,
    request_oauth_on_install: false,
    default_permissions: { contents: "read", metadata: "read", pull_requests: "write" },
    default_events: ["push", "pull_request"],
  };
}

/** Self-submitting HTML page that POSTs the manifest to GitHub. A manifest must
 *  be sent as a form field (it's a GitHub UI redirect), so the browser submits
 *  it; the JSON is embedded in a <script> (with `<` escaped) and copied into the
 *  hidden field to dodge attribute-escaping pitfalls. */
export function renderManifestForm(actionUrl: string, manifest: GithubAppManifest): string {
  const json = JSON.stringify(manifest).replace(/</g, "\\u003c");
  const action = actionUrl.replace(/"/g, "&quot;");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Creating GitHub App…</title></head>
<body style="font-family:system-ui;background:#0a0c10;color:#e8ecf4;display:flex;align-items:center;justify-content:center;height:100vh">
<form id="f" method="post" action="${action}">
<input type="hidden" name="manifest" id="m">
<noscript><button type="submit">Continue to GitHub</button></noscript>
</form>
<p>Redirecting to GitHub to create your App…</p>
<script id="d" type="application/json">${json}</script>
<script>document.getElementById("m").value=document.getElementById("d").textContent;document.getElementById("f").submit();</script>
</body></html>`;
}

/** Where the browser POSTs the manifest. Personal account vs an org. */
export function manifestPostUrl(org?: string | null): string {
  return org
    ? `https://github.com/organizations/${encodeURIComponent(org)}/settings/apps/new`
    : "https://github.com/settings/apps/new";
}

/** The credentials GitHub returns from the manifest `conversions` exchange. */
export interface AppRegistrationCredentials {
  appId: string;
  slug: string;
  name: string;
  htmlUrl: string;
  clientId: string;
  clientSecret: string;
  webhookSecret: string;
  privateKey: string;
}

type FetchLike = typeof fetch;

const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));

/** Trade the temporary manifest `code` for the App's credentials. Throws on a
 *  non-2xx response or a payload missing the fields we must persist. */
export async function exchangeManifestCode(
  code: string,
  fetchImpl: FetchLike = fetch,
  apiBase = "https://api.github.com",
): Promise<AppRegistrationCredentials> {
  const res = await fetchImpl(`${apiBase}/app-manifests/${encodeURIComponent(code)}/conversions`, {
    method: "POST",
    headers: { accept: "application/vnd.github+json", "user-agent": "shipsquares" },
  });
  if (!res.ok) throw new Error(`manifest conversion failed: HTTP ${res.status}`);
  const j = (await res.json()) as Record<string, unknown>;
  const creds: AppRegistrationCredentials = {
    appId: str(j.id),
    slug: str(j.slug),
    name: str(j.name),
    htmlUrl: str(j.html_url),
    clientId: str(j.client_id),
    clientSecret: str(j.client_secret),
    webhookSecret: str(j.webhook_secret),
    privateKey: str(j.pem),
  };
  // appId, privateKey and webhook_secret are load-bearing (token minting +
  // inbound signature verification); slug drives the install redirect.
  if (!creds.appId || !creds.privateKey || !creds.webhookSecret || !creds.slug) {
    throw new Error("manifest conversion response missing required fields");
  }
  return creds;
}
