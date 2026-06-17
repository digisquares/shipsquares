// @vitest-environment jsdom
import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { expectNoA11yViolations, renderComponent } from "../test/component";

import { Mail, dnsKindLabel, isValidFqdn, isValidLocalPart } from "./mail";

const origFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = origFetch;
  vi.restoreAllMocks();
});

const instance = {
  id: "mli_1",
  hostname: "mail.acme.com",
  status: "ready",
  port25Egress: "ok",
  ptrOk: true,
};
const domain = {
  id: "mld_1",
  fqdn: "acme.com",
  dkimSelector: "default",
  dnsMode: "hint",
  verificationStatus: "pending",
  inboxSubdomain: "inbox.acme.com",
};

interface Call {
  url: string;
  method: string;
}
/** URL+method-aware fetch mock; records calls for assertions. */
function mockApi(instances: unknown[] = [instance]) {
  const calls: Call[] = [];
  globalThis.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ url, method });
    let data: unknown = [];
    let status = 200;
    if (url.endsWith("/mail/instances") && method === "GET") data = instances;
    else if (/\/mail\/instances\/[^/]+\/domains$/.test(url)) data = [domain];
    else if (/\/mail\/domains\/[^/]+\/mailboxes$/.test(url) && method === "POST") {
      data = {
        mailbox: { id: "mbx_1", localPart: "alice", displayName: null, status: "active" },
        password: "OneTime-PW-123",
      };
      status = 201;
    } else if (/\/mail\/domains\/[^/]+\/mailboxes$/.test(url)) {
      data = [{ id: "mbx_1", localPart: "alice", displayName: null, status: "active" }];
    }
    return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(data) });
  }) as unknown as typeof fetch;
  return calls;
}

describe("mail pure helpers", () => {
  it("dnsKindLabel maps kinds", () => {
    expect(dnsKindLabel("mx")).toBe("MX");
    expect(dnsKindLabel("mta_sts")).toBe("MTA-STS");
    expect(dnsKindLabel("weird")).toBe("WEIRD");
  });
  it("isValidFqdn accepts domains, rejects junk", () => {
    expect(isValidFqdn("acme.com")).toBe(true);
    expect(isValidFqdn("mail.acme.co.uk")).toBe(true);
    expect(isValidFqdn("notadomain")).toBe(false);
    expect(isValidFqdn("bad_domain.com")).toBe(false);
    expect(isValidFqdn("")).toBe(false);
  });
  it("isValidLocalPart accepts mailbox parts, rejects spaces/@", () => {
    expect(isValidLocalPart("alice")).toBe(true);
    expect(isValidLocalPart("a.b+c-1_2")).toBe(true);
    expect(isValidLocalPart("has space")).toBe(false);
    expect(isValidLocalPart("a@b")).toBe(false);
  });
});

describe("Mail workspace (component)", () => {
  it("renders an instance + domain, verification pill, and add-domain form (mode select)", async () => {
    mockApi();
    const { container } = renderComponent(<Mail />);
    expect(await screen.findByText("mail.acme.com")).toBeTruthy();
    expect(await screen.findByText("acme.com")).toBeTruthy();
    expect(screen.getByLabelText("Status: Pending")).toBeTruthy();
    expect(screen.getByLabelText("New mail domain")).toBeTruthy();
    expect(screen.getByLabelText("DNS mode")).toBeTruthy();
    await expectNoA11yViolations(container);
  });

  it("empty state offers a Connect CTA (no dead end)", async () => {
    mockApi([]);
    renderComponent(<Mail />);
    expect(await screen.findByText("No mail server yet")).toBeTruthy();
    expect(screen.getByRole("button", { name: /connect mail server/i })).toBeTruthy();
  });

  it("blocks an invalid domain with an inline error and makes no API call", async () => {
    const calls = mockApi();
    renderComponent(<Mail />);
    await screen.findByText("acme.com");
    fireEvent.change(screen.getByLabelText("New mail domain"), { target: { value: "notadomain" } });
    fireEvent.click(screen.getByRole("button", { name: /add domain/i }));
    expect(await screen.findByText(/enter a valid domain/i)).toBeTruthy();
    expect(calls.some((c) => c.method === "POST" && /\/domains$/.test(c.url))).toBe(false);
  });

  it("creating a mailbox shows a copyable one-time password dialog (not a toast)", async () => {
    mockApi();
    renderComponent(<Mail />);
    await screen.findByText("acme.com");
    fireEvent.click(screen.getByRole("button", { name: /^mailboxes$/i }));
    const input = await screen.findByLabelText("New mailbox local part for acme.com");
    fireEvent.change(input, { target: { value: "alice" } });
    fireEvent.click(screen.getByRole("button", { name: /add mailbox/i }));
    expect(await screen.findByText("Mailbox created")).toBeTruthy();
    expect(screen.getByLabelText("mailbox password").textContent).toBe("OneTime-PW-123");
    expect(screen.getByRole("button", { name: /^copy$/i })).toBeTruthy();
  });
});
