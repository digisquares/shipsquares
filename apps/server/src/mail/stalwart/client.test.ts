import { describe, expect, it } from "vitest";

import { StalwartClient } from "./client.js";

interface Captured {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** A mock fetch that records each call and returns a queued JSON response. */
function mockFetch(responses: { status?: number; json?: unknown; text?: string }[]) {
  const calls: Captured[] = [];
  let i = 0;
  const impl = (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const headers = Object.fromEntries(
      Object.entries((init?.headers as Record<string, string>) ?? {}),
    );
    calls.push({
      url: String(url),
      method: init?.method ?? "GET",
      headers,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const r = responses[i++] ?? { status: 200, json: {} };
    const status = r.status ?? 200;
    const payload = r.text ?? JSON.stringify(r.json ?? {});
    return Promise.resolve(new Response(status === 204 ? null : payload, { status }));
  };
  return { impl: impl as unknown as typeof fetch, calls };
}

const make = (responses: Parameters<typeof mockFetch>[0]) => {
  const { impl, calls } = mockFetch(responses);
  const client = new StalwartClient({
    baseUrl: "https://mail.acme.com/",
    token: "tok_123",
    fetchImpl: impl,
  });
  return { client, calls };
};

describe("StalwartClient", () => {
  it("trims a trailing slash and sends bearer auth", async () => {
    const { client, calls } = make([{ status: 204 }]);
    await client.createDomain("acme.com");
    expect(calls[0]!.url).toBe("https://mail.acme.com/api/principal");
    expect(calls[0]!.headers["authorization"]).toBe("Bearer tok_123");
  });

  it("createDomain POSTs a domain principal", async () => {
    const { client, calls } = make([{ status: 200 }]);
    await client.createDomain("acme.com");
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.body).toEqual({ type: "domain", name: "acme.com" });
  });

  it("createMailbox sets the password as a secret (and we never read it back)", async () => {
    const { client, calls } = make([{ status: 200 }]);
    await client.createMailbox({ email: "a@acme.com", password: "s3cret", quotaBytes: 1024 });
    expect(calls[0]!.body).toMatchObject({
      type: "individual",
      name: "a@acme.com",
      emails: ["a@acme.com"],
      secrets: ["s3cret"],
      quota: 1024,
    });
  });

  it("listDomains maps the items array to names", async () => {
    const { client } = make([{ json: { items: [{ name: "a.com" }, { name: "b.com" }] } }]);
    expect(await client.listDomains()).toEqual(["a.com", "b.com"]);
  });

  it("getDnsRecords accepts both array and {records} shapes", async () => {
    const recs = [{ type: "MX", name: "acme.com", content: "10 mx.acme.com." }];
    const a = make([{ json: recs }]);
    expect(await a.client.getDnsRecords("acme.com")).toEqual(recs);
    const b = make([{ json: { records: recs } }]);
    expect(await b.client.getDnsRecords("acme.com")).toEqual(recs);
  });

  it("generateDkim returns the selector + public key", async () => {
    const { client } = make([{ json: { selector: "default", publicKey: "MIGf" } }]);
    expect(await client.generateDkim("acme.com")).toEqual({
      selector: "default",
      publicKey: "MIGf",
    });
  });

  it("setDnsProvider flattens credentials into settings keys", async () => {
    const { client, calls } = make([{ status: 200 }]);
    await client.setDnsProvider({ type: "cloudflare", credentials: { "api-key": "k1" } });
    expect(calls[0]!.url).toBe("https://mail.acme.com/api/settings");
    expect(calls[0]!.body).toEqual({
      "dns.provider.type": "cloudflare",
      "dns.provider.api-key": "k1",
    });
  });

  it("throws with status + detail on a non-ok response", async () => {
    const { client } = make([{ status: 409, text: "domain exists" }]);
    await expect(client.createDomain("acme.com")).rejects.toThrow(/409 domain exists/);
  });

  it("ping returns false when the request throws", async () => {
    const client = new StalwartClient({
      baseUrl: "https://mail.acme.com",
      token: "t",
      fetchImpl: (() => Promise.reject(new Error("down"))) as unknown as typeof fetch,
    });
    expect(await client.ping()).toBe(false);
  });
});
