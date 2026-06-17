import { createClient, type ApiClient } from "@ss/openapi-client";

import type { App, Deployment, Metrics, Page, RuntimeLogLine } from "./types.js";

// The control-plane surface the MCP tools depend on — an interface so tests
// inject a fake. Backed by the generated @ss/openapi-client (typed against the
// committed openapi.json, drift-gated in CI); the wrapper owns the /api/v1
// prefix and the better-auth session cookie (SHIPSQUARES_COOKIE — run
// `ss login` to get one). Bearer API keys slot in server-side later (05).
export interface Api {
  listApps(): Promise<App[]>;
  getApp(appId: string): Promise<App>;
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

interface FetchResult {
  data?: unknown;
  error?: unknown;
  response: Response;
}

export class HttpApiClient implements Api {
  private readonly client: ApiClient;

  constructor(baseUrl: string, cookie?: string, apiKey?: string) {
    this.client = createClient(baseUrl, {
      ...(cookie ? { cookie } : {}),
      ...(apiKey ? { getToken: () => apiKey } : {}),
    });
  }

  private unwrap<T>(r: FetchResult): T {
    if (r.error !== undefined || !r.response.ok) {
      const detail =
        r.error && typeof r.error === "object" && "detail" in r.error
          ? String((r.error as { detail?: unknown }).detail)
          : `request failed (${r.response.status})`;
      throw new HttpError(r.response.status, detail);
    }
    return r.data as T;
  }

  async listApps(): Promise<App[]> {
    const r = await this.client.GET("/apps", { params: { query: { limit: 100 } } });
    return this.unwrap<Page<App>>(r).data;
  }
  async getApp(appId: string): Promise<App> {
    return this.unwrap<App>(
      await this.client.GET("/apps/{id}", { params: { path: { id: appId } } }),
    );
  }
  async deploy(appId: string): Promise<{ id: string }> {
    return this.unwrap<{ id: string }>(
      await this.client.POST("/apps/{appId}/deployments", { params: { path: { appId } } }),
    );
  }
  async getDeployment(id: string): Promise<Deployment> {
    return this.unwrap<Deployment>(
      await this.client.GET("/deployments/{id}", { params: { path: { id } } }),
    );
  }
  async listDeployments(appId: string, limit: number): Promise<Deployment[]> {
    const r = await this.client.GET("/apps/{appId}/deployments", {
      params: { path: { appId }, query: { limit } },
    });
    return this.unwrap<Page<Deployment>>(r).data;
  }
  async appMetrics(appId: string): Promise<Metrics> {
    return this.unwrap<Metrics>(
      await this.client.GET("/apps/{id}/metrics", { params: { path: { id: appId } } }),
    );
  }
  async appLogs(appId: string, tail: number): Promise<RuntimeLogLine[]> {
    const r = await this.client.GET("/apps/{id}/logs", {
      params: { path: { id: appId }, query: { tail } },
    });
    return this.unwrap<{ lines: RuntimeLogLine[] }>(r).lines;
  }
}
