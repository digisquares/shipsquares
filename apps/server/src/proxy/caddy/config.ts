import {
  type DesiredApp,
  type DesiredBasicAuth,
  type DesiredCustomCert,
  type DesiredDomain,
  type DesiredRedirect,
  routeId,
} from "../types.js";

// The Caddy driver's pure core (08-proxy-ssl.md): desired state → Caddy admin-API
// JSON. No reference drives Caddy this way, so this is built fresh. The HTTP
// POST /load of this config is the runtime CaddyAdminClient.

export interface CaddyHandler {
  handler: string;
  [key: string]: unknown;
}

export interface CaddyRoute {
  "@id"?: string;
  match?: Array<{ host?: string[]; path?: string[] }>;
  handle: CaddyHandler[];
  terminal?: boolean;
}

export interface TlsPolicy {
  subjects: string[];
  on_demand?: boolean;
}

export interface CaddyConfig {
  apps: {
    http: {
      servers: {
        edge: {
          listen: string[];
          routes: CaddyRoute[];
          automatic_https: { disable_redirects: boolean };
        };
      };
    };
    tls: {
      automation: {
        policies: TlsPolicy[];
        on_demand?: { permission: { module: "http"; endpoint: string } };
      };
      certificates?: { load_pem: Array<{ certificate: string; key: string }> };
    };
  };
}

export interface GenerateInput {
  apps: DesiredApp[];
  domains: DesiredDomain[];
  redirects?: DesiredRedirect[];
  basicAuth?: Record<string, DesiredBasicAuth>; // appId -> auth
  customCerts?: DesiredCustomCert[];
  /** the control plane's /internal/tls/ask URL — required for Caddy to issue
   *  on-demand certs (it refuses on_demand without a permission module) */
  askEndpoint?: string;
}

function hstsHandler(): CaddyHandler {
  return {
    handler: "headers",
    response: { set: { "Strict-Transport-Security": ["max-age=31536000"] } },
  };
}

function basicAuthHandler(auth: DesiredBasicAuth): CaddyHandler {
  return {
    handler: "authentication",
    providers: {
      http_basic: { accounts: [{ username: auth.username, password: auth.bcryptHash }] },
    },
  };
}

function reverseProxyHandler(app: DesiredApp): CaddyHandler {
  return {
    handler: "reverse_proxy",
    upstreams: [{ dial: app.target.upstream }],
    headers: {
      request: {
        set: {
          "X-Forwarded-Proto": ["{http.request.scheme}"],
          "X-Real-IP": ["{http.request.remote.host}"],
        },
      },
    },
  };
}

function appRoute(app: DesiredApp, basicAuth?: DesiredBasicAuth): CaddyRoute {
  const handle: CaddyHandler[] = [];
  if (app.hsts) handle.push(hstsHandler());
  if (basicAuth) handle.push(basicAuthHandler(basicAuth)); // in front of reverse_proxy
  handle.push(reverseProxyHandler(app));
  return { "@id": routeId(app.appId), match: [{ host: app.hosts }], handle, terminal: true };
}

function redirectRoute(redirect: DesiredRedirect): CaddyRoute {
  return {
    "@id": `redirect_${redirect.id}`,
    match: [{ host: redirect.fromHosts }],
    handle: [
      {
        handler: "static_response",
        status_code: redirect.permanent ? 308 : 302,
        headers: { Location: [redirect.toTarget] },
      },
    ],
    terminal: true,
  };
}

/** Pure: desired state → the complete `edge` server config + tls policies. */
export function generateCaddyConfig(input: GenerateInput): CaddyConfig {
  // Redirect routes go AHEAD of app routes so they short-circuit.
  const redirectRoutes = (input.redirects ?? []).map(redirectRoute);
  const appRoutes = input.apps.map((app) => appRoute(app, input.basicAuth?.[app.appId]));

  const customCertDomains = new Set((input.customCerts ?? []).map((c) => c.domain));
  const policies: TlsPolicy[] = input.domains
    .filter((d) => !customCertDomains.has(d.fqdn)) // custom certs skip ACME
    .map((d) =>
      d.managed === "on-demand" ? { subjects: [d.fqdn], on_demand: true } : { subjects: [d.fqdn] },
    );

  const config: CaddyConfig = {
    apps: {
      http: {
        servers: {
          edge: {
            listen: [":80", ":443"],
            routes: [...redirectRoutes, ...appRoutes],
            automatic_https: { disable_redirects: false },
          },
        },
      },
      tls: { automation: { policies } },
    },
  };

  if (input.askEndpoint && policies.some((p) => p.on_demand)) {
    config.apps.tls.automation.on_demand = {
      permission: { module: "http", endpoint: input.askEndpoint },
    };
  }

  if (input.customCerts && input.customCerts.length > 0) {
    config.apps.tls.certificates = {
      load_pem: input.customCerts.map((c) => ({ certificate: c.certPem, key: c.keyPem })),
    };
  }

  return config;
}
