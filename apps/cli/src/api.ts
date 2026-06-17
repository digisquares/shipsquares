import { cookieHeaderFrom } from "./cookie.js";
import type { App, Deployment, Metrics, Page, RuntimeLogLine } from "./types.js";

export interface LoginResult {
  ok: boolean;
  status: number;
  cookie: string; // the Cookie header to persist on success
}

// The surface the commands depend on — an interface so tests inject a fake.
export interface Api {
  login(email: string, password: string): Promise<LoginResult>;
  listApps(): Promise<App[]>;
  deploy(appId: string): Promise<{ id: string }>;
  getDeployment(id: string): Promise<Deployment>;
  listDeployments(appId: string, limit: number): Promise<Deployment[]>;
  appMetrics(appId: string): Promise<Metrics>;
  appLogs(appId: string, tail: number): Promise<RuntimeLogLine[]>;
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// Real HTTP client (Node 22 global fetch). Auth: a SHIPSQUARES_API_KEY bearer
// token (ss_live_…, CI-friendly) wins over the saved session cookie; login
// captures the Set-Cookie headers and returns them as a ready Cookie header.
export class ApiClient implements Api {
  constructor(
    private readonly baseUrl: string,
    private readonly cookie?: string,
    private readonly apiKey: string | undefined = process.env.SHIPSQUARES_API_KEY,
  ) {}

  private url(path: string): string {
    return `${this.baseUrl.replace(/\/$/, "")}${path}`;
  }

  private async req<T>(method: string, path: string): Promise<T> {
    const res = await fetch(this.url(path), {
      method,
      headers: this.apiKey
        ? { authorization: `Bearer ${this.apiKey}` }
        : this.cookie
          ? { cookie: this.cookie }
          : {},
    });
    const body = (await res.json().catch(() => null)) as unknown;
    if (!res.ok) {
      const detail =
        body && typeof body === "object" && "detail" in body
          ? String((body as { detail?: unknown }).detail)
          : `request failed (${res.status})`;
      throw new HttpError(res.status, detail);
    }
    return body as T;
  }

  async login(email: string, password: string): Promise<LoginResult> {
    const res = await fetch(this.url("/auth/sign-in/email"), {
      method: "POST",
      headers: { "content-type": "application/json", origin: this.baseUrl.replace(/\/$/, "") },
      body: JSON.stringify({ email, password }),
    });
    return { ok: res.ok, status: res.status, cookie: cookieHeaderFrom(res.headers.getSetCookie()) };
  }

  async listApps(): Promise<App[]> {
    return (await this.req<Page<App>>("GET", "/api/v1/apps?limit=100")).data;
  }
  async deploy(appId: string): Promise<{ id: string }> {
    return this.req<{ id: string }>("POST", `/api/v1/apps/${appId}/deployments`);
  }
  async getDeployment(id: string): Promise<Deployment> {
    return this.req<Deployment>("GET", `/api/v1/deployments/${id}`);
  }
  async listDeployments(appId: string, limit: number): Promise<Deployment[]> {
    return (
      await this.req<Page<Deployment>>("GET", `/api/v1/apps/${appId}/deployments?limit=${limit}`)
    ).data;
  }
  async appMetrics(appId: string): Promise<Metrics> {
    return this.req<Metrics>("GET", `/api/v1/apps/${appId}/metrics`);
  }
  async appLogs(appId: string, tail: number): Promise<RuntimeLogLine[]> {
    return (
      await this.req<{ lines: RuntimeLogLine[] }>("GET", `/api/v1/apps/${appId}/logs?tail=${tail}`)
    ).lines;
  }
}
