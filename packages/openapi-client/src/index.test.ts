import { describe, expect, it, vi } from "vitest";

import { createClient } from "./index.js";

const okJson = () =>
  new Response(JSON.stringify({ data: [], page: {} }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

describe("createClient", () => {
  it("prefixes every path with /api/v1 under the given base url", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => okJson());
    const client = createClient("http://ship.local:3000", { fetchImpl });
    await client.GET("/apps");
    const req = fetchImpl.mock.calls[0]![0] as Request;
    expect(req.url).toBe("http://ship.local:3000/api/v1/apps");
  });

  it("normalizes a trailing slash on the base url", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => okJson());
    const client = createClient("http://ship.local:3000/", { fetchImpl });
    await client.GET("/apps");
    expect((fetchImpl.mock.calls[0]![0] as Request).url).toBe("http://ship.local:3000/api/v1/apps");
  });

  it("sends the session cookie (cookie-session API)", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => okJson());
    const client = createClient("http://x", { cookie: "better-auth.session_token=abc", fetchImpl });
    await client.GET("/apps");
    const req = fetchImpl.mock.calls[0]![0] as Request;
    expect(req.headers.get("cookie")).toBe("better-auth.session_token=abc");
  });

  it("sends a bearer token when provided (API keys, 05)", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => okJson());
    const client = createClient("http://x", { getToken: () => "key_123", fetchImpl });
    await client.GET("/apps");
    expect((fetchImpl.mock.calls[0]![0] as Request).headers.get("authorization")).toBe(
      "Bearer key_123",
    );
  });
});
