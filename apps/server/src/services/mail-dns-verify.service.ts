import { resolveCname, resolveMx, resolveSrv, resolveTxt } from "node:dns/promises";

import { eq, inArray } from "drizzle-orm";
import type PgBoss from "pg-boss";

import type { Db } from "../db/index.js";
import { mailDnsRecords, mailDomains } from "../db/schema/index.js";
import type { MailDnsRecordKind } from "../mail/dns/records.js";
import {
  type DomainStatus,
  type RecordStatus,
  rollupDomainStatus,
  verifyRecord,
} from "../mail/dns/verify.js";

// mail-dns-verify (R9 · mail/03). Wraps the pure verifier (mail/dns/verify.ts)
// with real resolver lookups + the DB state machine. The cron picks up domains
// in pending/verifying and advances each record's status; the domain rolls up to
// verified only when MX/SPF/DKIM/DMARC align. Resolver is injected so the core
// (verifyDomainRecords) is unit-testable without DNS or a DB.

export const MAIL_DNS_VERIFY_QUEUE = "mail-dns-verify";
const MAIL_DNS_VERIFY_CRON = "*/2 * * * *"; // every 2 min while domains are pending
const BATCH = 100;

/** Resolve the observed values at a record's name for its DNS type. Errors
 *  (NXDOMAIN, timeouts) collapse to no values, which the verifier treats as
 *  "not yet present" rather than throwing. */
export type ResolveFn = (name: string, type: string) => Promise<string[]>;

export const dnsResolve: ResolveFn = async (name, type) => {
  const n = name.replace(/\.$/, "");
  try {
    switch (type.toUpperCase()) {
      case "MX":
        return (await resolveMx(n)).map((r) => r.exchange);
      case "TXT":
        return (await resolveTxt(n)).map((parts) => parts.join(""));
      case "CNAME":
        return await resolveCname(n);
      case "SRV":
        return (await resolveSrv(n)).map((r) => `${r.priority} ${r.weight} ${r.port} ${r.name}`);
      default:
        return [];
    }
  } catch {
    return [];
  }
};

export interface VerifiableRecord {
  id: string;
  kind: string;
  name: string;
  type: string;
  value: string;
  priority: number | null;
}

export interface RecordUpdate {
  id: string;
  status: RecordStatus;
  detail: string | null;
}

export interface DomainVerification {
  records: RecordUpdate[];
  domainStatus: DomainStatus;
}

/** Pure-ish core: verify every record against injected resolver results and roll
 *  up the domain status. No DB writes — returns the updates to apply. */
export async function verifyDomainRecords(
  records: readonly VerifiableRecord[],
  resolve: ResolveFn,
): Promise<DomainVerification> {
  const updates: RecordUpdate[] = [];
  const verdicts = [];
  for (const r of records) {
    const values = await resolve(r.name, r.type);
    const verdict = verifyRecord(
      {
        kind: r.kind as MailDnsRecordKind,
        name: r.name,
        type: r.type,
        value: r.value,
        priority: r.priority,
      },
      { values },
    );
    verdicts.push(verdict);
    updates.push({ id: r.id, status: verdict.status, detail: verdict.detail ?? null });
  }
  return { records: updates, domainStatus: rollupDomainStatus(verdicts) };
}

/** Verify one domain and persist the record + domain state transitions. */
export async function verifyDomain(
  db: Db,
  domainId: string,
  resolve: ResolveFn = dnsResolve,
): Promise<DomainStatus> {
  const recs = await db
    .select()
    .from(mailDnsRecords)
    .where(eq(mailDnsRecords.mailDomainId, domainId));
  if (recs.length === 0) return "pending";

  const { records, domainStatus } = await verifyDomainRecords(recs, resolve);
  const now = new Date();
  for (const u of records) {
    await db
      .update(mailDnsRecords)
      .set({ status: u.status, detail: u.detail, lastCheckedAt: now })
      .where(eq(mailDnsRecords.id, u.id));
  }
  await db
    .update(mailDomains)
    .set({
      verificationStatus: domainStatus,
      verifiedAt: domainStatus === "verified" ? now : null,
      updatedAt: now,
    })
    .where(eq(mailDomains.id, domainId));
  return domainStatus;
}

/** Sweep domains awaiting verification and advance each. */
export async function runMailDnsVerify(
  db: Db,
  resolve: ResolveFn = dnsResolve,
): Promise<{ checked: number; verified: number }> {
  const domains = await db
    .select({ id: mailDomains.id })
    .from(mailDomains)
    .where(inArray(mailDomains.verificationStatus, ["pending", "verifying"]))
    .limit(BATCH);
  let verified = 0;
  for (const d of domains) {
    const status = await verifyDomain(db, d.id, resolve);
    if (status === "verified") verified++;
  }
  return { checked: domains.length, verified };
}

/** Register the verification cron (idempotent; non-fatal without pg-boss). */
export async function bootMailDnsVerify(db: Db, boss: PgBoss): Promise<void> {
  await boss.createQueue(MAIL_DNS_VERIFY_QUEUE);
  await boss.unschedule(MAIL_DNS_VERIFY_QUEUE).catch(() => undefined);
  await boss.schedule(MAIL_DNS_VERIFY_QUEUE, MAIL_DNS_VERIFY_CRON, {}, { tz: "UTC" });
  await boss.work(MAIL_DNS_VERIFY_QUEUE, async () => {
    await runMailDnsVerify(db);
  });
}
