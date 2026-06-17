import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { type Env, NotFoundError } from "@ss/shared";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Db } from "../db/index.js";
import * as schema from "../db/schema/index.js";
import { catalogServices, mailInstances, organizations, servers } from "../db/schema/index.js";
import type { RawDnsRecord } from "../mail/dns/records.js";
import type { StalwartClient } from "../mail/stalwart/client.js";

import { verifyDomain } from "./mail-dns-verify.service.js";
import {
  type MailDeps,
  addDomain,
  createAlias,
  createMailbox,
  deleteAlias,
  getDomain,
  getDomainDns,
  getInstance,
  listAliases,
  listMailboxes,
  provisionInstance,
  requestVerification,
} from "./mail.service.js";

// Real-Postgres integration via in-process pglite (no Docker) — the committed
// migration 0023 (mail_*) runs, so the actual schema/FKs/enums are exercised.
// Stalwart is faked (injected clientFor), so the orchestration is verified
// without a live mail server.

let pg: PGlite;
let db: Db;

const KEY = randomBytes(32).toString("base64");
const config = { SHIPSQUARES_MASTER_KEY: KEY } as unknown as Env;

interface FakeCalls {
  createDomain: string[];
  createMailbox: { email: string; password: string }[];
  deleteMailbox: string[];
}
function fakeClientDeps(): { deps: MailDeps; calls: FakeCalls } {
  const calls: FakeCalls = { createDomain: [], createMailbox: [], deleteMailbox: [] };
  const records: RawDnsRecord[] = [
    { type: "MX", name: "acme.com.", content: "10 mx.acme.com." },
    { type: "TXT", name: "acme.com.", content: "v=spf1 mx -all" },
    { type: "TXT", name: "default._domainkey.acme.com.", content: "v=DKIM1; p=KEY" },
    { type: "TXT", name: "_dmarc.acme.com.", content: "v=DMARC1; p=reject" },
  ];
  const fake = {
    createDomain: (fqdn: string) => {
      calls.createDomain.push(fqdn);
      return Promise.resolve();
    },
    generateDkim: () => Promise.resolve({ selector: "default", publicKey: "KEY" }),
    getDnsRecords: () => Promise.resolve(records),
    createMailbox: (input: { email: string; password: string }) => {
      calls.createMailbox.push({ email: input.email, password: input.password });
      return Promise.resolve();
    },
    deleteMailbox: (email: string) => {
      calls.deleteMailbox.push(email);
      return Promise.resolve();
    },
  };
  return { deps: { clientFor: () => fake as unknown as StalwartClient }, calls };
}

beforeAll(async () => {
  pg = new PGlite();
  const d = drizzle(pg, { schema });
  await migrate(d, { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });
  db = d as unknown as Db;
  await db.insert(organizations).values([
    { id: "org_a", name: "Org A", slug: "org-a" },
    { id: "org_b", name: "Org B", slug: "org-b" },
  ]);
  await db
    .insert(servers)
    .values({ id: "srv_a", organizationId: "org_a", name: "mail", host: "1.2.3.4" });
  await db
    .insert(catalogServices)
    .values({ id: "svc_a", organizationId: "org_a", slug: "stalwart", name: "Mail" });
}, 60_000);

afterAll(async () => {
  await pg?.close();
});

async function provision() {
  return provisionInstance(db, config, "org_a", {
    catalogServiceId: "svc_a",
    serverId: "srv_a",
    hostname: "mail.acme.com",
    adminSecret: "super-secret-admin-token",
  });
}

describe("mail.service (pglite integration)", () => {
  it("provisionInstance seals the admin secret and never exposes it", async () => {
    const inst = await provision();
    expect(inst.hostname).toBe("mail.acme.com");
    expect(inst).not.toHaveProperty("adminSecretRef");
    // The stored ref is a sealed JSON blob, not the plaintext token.
    const [row] = await db.select().from(mailInstances).where(eq(mailInstances.id, inst.id));
    expect(row!.adminSecretRef).not.toContain("super-secret-admin-token");
    expect(() => JSON.parse(row!.adminSecretRef)).not.toThrow();
  });

  it("provisionInstance 404s on a catalog service / server from another org", async () => {
    await expect(
      provisionInstance(db, config, "org_b", {
        catalogServiceId: "svc_a",
        serverId: "srv_a",
        hostname: "mail.evil.com",
        adminSecret: "x",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("addDomain creates the domain + normalized DNS records (hint mode, pending)", async () => {
    const inst = await provision();
    const { deps, calls } = fakeClientDeps();
    const { domain, records } = await addDomain(
      db,
      config,
      "org_a",
      inst.id,
      { fqdn: "ACME.com" },
      deps,
    );

    expect(calls.createDomain).toEqual(["acme.com"]);
    expect(domain.fqdn).toBe("acme.com");
    expect(domain.inboxSubdomain).toBe("inbox.acme.com");
    expect(domain.dnsMode).toBe("hint");
    expect(domain.verificationStatus).toBe("pending");
    expect(domain.dkimSelector).toBe("default");
    expect(records.map((r) => r.kind).sort()).toEqual(["dkim", "dmarc", "mx", "spf"]);
  });

  it("addDomain rejects an invalid fqdn", async () => {
    const inst = await provision();
    const { deps } = fakeClientDeps();
    await expect(
      addDomain(db, config, "org_a", inst.id, { fqdn: "notadomain" }, deps),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("enforces tenant isolation on instance access", async () => {
    const inst = await provision();
    await expect(getInstance(db, "org_b", inst.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("createMailbox sets the password in Stalwart, returns it once, stores none", async () => {
    const inst = await provision();
    const { deps, calls } = fakeClientDeps();
    const { domain } = await addDomain(db, config, "org_a", inst.id, { fqdn: "acme.com" }, deps);

    const { mailbox, password } = await createMailbox(
      db,
      config,
      "org_a",
      domain.id,
      { localPart: "Alice", displayName: "Alice A" },
      deps,
    );
    expect(mailbox.localPart).toBe("alice");
    expect(password.length).toBeGreaterThan(0);
    expect(calls.createMailbox).toEqual([{ email: "alice@acme.com", password }]);

    const list = await listMailboxes(db, "org_a", domain.id);
    expect(list.map((m) => m.localPart)).toContain("alice");
  });

  it("requestVerification flips the domain + records to verifying", async () => {
    const inst = await provision();
    const { deps } = fakeClientDeps();
    const { domain } = await addDomain(db, config, "org_a", inst.id, { fqdn: "acme.com" }, deps);

    const updated = await requestVerification(db, "org_a", domain.id);
    expect(updated.verificationStatus).toBe("verifying");
  });

  it("verifyDomain persists record + domain state when DNS aligns", async () => {
    const inst = await provision();
    const { deps } = fakeClientDeps();
    const { domain } = await addDomain(db, config, "org_a", inst.id, { fqdn: "acme.com" }, deps);

    // Aligned resolver: apex carries MX + SPF; DKIM + DMARC at their names.
    const aligned = (name: string) => {
      const map: Record<string, string[]> = {
        "acme.com": ["mx.acme.com", "v=spf1 mx -all"],
        "default._domainkey.acme.com": ["v=DKIM1; p=KEY"],
        "_dmarc.acme.com": ["v=DMARC1; p=reject"],
      };
      return Promise.resolve(map[name.replace(/\.$/, "")] ?? []);
    };

    const status = await verifyDomain(db, domain.id, aligned);
    expect(status).toBe("verified");

    const refreshed = await getDomain(db, "org_a", domain.id);
    expect(refreshed.verificationStatus).toBe("verified");
    const dns = await getDomainDns(db, "org_a", domain.id);
    expect(dns.every((r) => r.status === "verified")).toBe(true);
  });

  it("alias create/list/delete round-trips and 404s on re-delete", async () => {
    const inst = await provision();
    const { deps } = fakeClientDeps();
    const { domain } = await addDomain(db, config, "org_a", inst.id, { fqdn: "acme.com" }, deps);

    const alias = await createAlias(db, "org_a", domain.id, {
      alias: "Team",
      destinations: ["alice@acme.com"],
    });
    expect(alias.alias).toBe("team");
    expect((await listAliases(db, "org_a", domain.id)).map((a) => a.alias)).toContain("team");

    await deleteAlias(db, "org_a", alias.id);
    await expect(deleteAlias(db, "org_a", alias.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});
