import { randomBytes } from "node:crypto";

import { AppError, type Env, NotFoundError, newId } from "@ss/shared";
import { and, asc, desc, eq } from "drizzle-orm";

import type { Db } from "../db/index.js";
import {
  catalogServices,
  mailAliases,
  mailDnsRecords,
  mailDomains,
  mailInstances,
  mailboxes,
  servers,
} from "../db/schema/index.js";
import { type NormalizedDnsRecord, normalizeStalwartRecords } from "../mail/dns/records.js";
import { StalwartClient } from "../mail/stalwart/client.js";
import { loadMasterKey, open, seal } from "../secrets/crypto.js";
import type { SealedValue } from "../secrets/types.js";

// Managed-email orchestration (R9 · mail/01-architecture.md). The single seam
// that talks to Stalwart is the StalwartClient, built per-instance from the
// sealed admin token. Every function is org-scoped (load by id AND org → 404)
// so a body/param can never reach another tenant's mail (IDOR closed). The
// client factory is injectable so the orchestration is unit/pglite-testable
// against a fake Stalwart. Mailbox passwords are set in Stalwart and never
// stored (mail/02, mail/04).

const KEY_VERSION = 1;

function masterKey(config: Env): Buffer {
  try {
    return loadMasterKey(config.SHIPSQUARES_MASTER_KEY);
  } catch {
    throw new AppError("Managed email requires SHIPSQUARES_MASTER_KEY", {
      status: 400,
      code: "secrets.unconfigured",
    });
  }
}
const sealStr = (plain: string, config: Env): string =>
  JSON.stringify(seal(plain, masterKey(config), KEY_VERSION));
const openStr = (s: string, config: Env): string =>
  open(JSON.parse(s) as SealedValue, masterKey(config));

type InstanceRow = typeof mailInstances.$inferSelect;
type DomainRow = typeof mailDomains.$inferSelect;
type DnsRecordRow = typeof mailDnsRecords.$inferSelect;
type MailboxRow = typeof mailboxes.$inferSelect;
type AliasRow = typeof mailAliases.$inferSelect;

/** Build a StalwartClient for an instance, opening its sealed admin token. */
export type ClientFor = (instance: InstanceRow, config: Env) => StalwartClient;
const defaultClientFor: ClientFor = (instance, config) =>
  new StalwartClient({
    baseUrl: `https://${instance.hostname}`,
    token: openStr(instance.adminSecretRef, config),
  });

export interface MailDeps {
  clientFor?: ClientFor;
}

// ── Views (never expose sealed refs) ────────────────────────────────────────

export interface MailInstanceView {
  id: string;
  catalogServiceId: string;
  serverId: string;
  hostname: string;
  storeBackend: string;
  status: string;
  port25Egress: string;
  ptrOk: boolean | null;
  createdAt: string;
}
export interface MailDomainView {
  id: string;
  mailInstanceId: string;
  fqdn: string;
  dkimSelector: string;
  dnsMode: string;
  verificationStatus: string;
  inboxSubdomain: string;
  createdAt: string;
}
export interface MailDnsRecordView {
  id: string;
  kind: string;
  name: string;
  type: string;
  value: string;
  priority: number | null;
  status: string;
  detail: string | null;
}
export interface MailboxView {
  id: string;
  mailDomainId: string;
  localPart: string;
  displayName: string | null;
  quotaBytes: number | null;
  status: string;
  createdAt: string;
}
export interface MailAliasView {
  id: string;
  alias: string;
  destinations: string[];
  createdAt: string;
}

const toInstanceView = (r: InstanceRow): MailInstanceView => ({
  id: r.id,
  catalogServiceId: r.catalogServiceId,
  serverId: r.serverId,
  hostname: r.hostname,
  storeBackend: r.storeBackend,
  status: r.status,
  port25Egress: r.port25Egress,
  ptrOk: r.ptrOk,
  createdAt: r.createdAt.toISOString(),
});
const toDomainView = (r: DomainRow): MailDomainView => ({
  id: r.id,
  mailInstanceId: r.mailInstanceId,
  fqdn: r.fqdn,
  dkimSelector: r.dkimSelector,
  dnsMode: r.dnsMode,
  verificationStatus: r.verificationStatus,
  inboxSubdomain: r.inboxSubdomain,
  createdAt: r.createdAt.toISOString(),
});
const toRecordView = (r: DnsRecordRow): MailDnsRecordView => ({
  id: r.id,
  kind: r.kind,
  name: r.name,
  type: r.type,
  value: r.value,
  priority: r.priority,
  status: r.status,
  detail: r.detail,
});
const toMailboxView = (r: MailboxRow): MailboxView => ({
  id: r.id,
  mailDomainId: r.mailDomainId,
  localPart: r.localPart,
  displayName: r.displayName,
  quotaBytes: r.quotaBytes,
  status: r.status,
  createdAt: r.createdAt.toISOString(),
});
const toAliasView = (r: AliasRow): MailAliasView => ({
  id: r.id,
  alias: r.alias,
  destinations: r.destinations,
  createdAt: r.createdAt.toISOString(),
});

// ── Scoped loaders (tenant isolation / IDOR guard) ──────────────────────────

async function loadInstance(db: Db, orgId: string, id: string): Promise<InstanceRow> {
  const [row] = await db
    .select()
    .from(mailInstances)
    .where(and(eq(mailInstances.id, id), eq(mailInstances.organizationId, orgId)))
    .limit(1);
  if (!row) throw new NotFoundError("mail instance not found");
  return row;
}
async function loadDomain(db: Db, orgId: string, id: string): Promise<DomainRow> {
  const [row] = await db
    .select()
    .from(mailDomains)
    .where(and(eq(mailDomains.id, id), eq(mailDomains.organizationId, orgId)))
    .limit(1);
  if (!row) throw new NotFoundError("mail domain not found");
  return row;
}

// ── Instances ───────────────────────────────────────────────────────────────

export async function listInstances(db: Db, orgId: string): Promise<MailInstanceView[]> {
  const rows = await db
    .select()
    .from(mailInstances)
    .where(eq(mailInstances.organizationId, orgId))
    .orderBy(desc(mailInstances.createdAt));
  return rows.map(toInstanceView);
}

export async function getInstance(db: Db, orgId: string, id: string): Promise<MailInstanceView> {
  return toInstanceView(await loadInstance(db, orgId, id));
}

export interface ProvisionInstanceInput {
  catalogServiceId: string;
  serverId: string;
  hostname: string;
  /** The first-boot admin secret the Stalwart install was given — sealed here. */
  adminSecret: string;
  storeBackend?: "managed_pg" | "filesystem";
  metadataDbId?: string | null;
}

/**
 * Register an installed Stalwart catalog service as a mail instance: verify the
 * catalog service + server belong to the org, seal the admin secret, and record
 * the instance. (The container itself is brought up via the catalog one-click
 * flow; this binds it to the mail model.)
 */
export async function provisionInstance(
  db: Db,
  config: Env,
  orgId: string,
  input: ProvisionInstanceInput,
): Promise<MailInstanceView> {
  const [svc] = await db
    .select()
    .from(catalogServices)
    .where(
      and(
        eq(catalogServices.id, input.catalogServiceId),
        eq(catalogServices.organizationId, orgId),
      ),
    )
    .limit(1);
  if (!svc) throw new NotFoundError("catalog service not found");
  const [srv] = await db
    .select()
    .from(servers)
    .where(and(eq(servers.id, input.serverId), eq(servers.organizationId, orgId)))
    .limit(1);
  if (!srv) throw new NotFoundError("server not found");

  const [row] = await db
    .insert(mailInstances)
    .values({
      id: newId("mli"),
      organizationId: orgId,
      catalogServiceId: input.catalogServiceId,
      serverId: input.serverId,
      hostname: input.hostname,
      adminSecretRef: sealStr(input.adminSecret, config),
      storeBackend: input.storeBackend ?? "filesystem",
      metadataDbId: input.metadataDbId ?? null,
      status: "ready",
    })
    .returning();
  return toInstanceView(row!);
}

// ── Domains ─────────────────────────────────────────────────────────────────

/** Pure: normalized Stalwart records → mail_dns_records insert values. */
export function dnsRecordInsertValues(
  domainId: string,
  records: readonly NormalizedDnsRecord[],
): (typeof mailDnsRecords.$inferInsert)[] {
  return records.map((r) => ({
    id: newId("mdr"),
    mailDomainId: domainId,
    kind: r.kind,
    name: r.name,
    type: r.type,
    value: r.value,
    priority: r.priority,
  }));
}

export interface AddDomainInput {
  fqdn: string;
  dnsMode?: "auto" | "hint";
}

export interface DomainWithRecords {
  domain: MailDomainView;
  records: MailDnsRecordView[];
}

/**
 * Add a domain to an instance: create it in Stalwart, generate DKIM, fetch the
 * required DNS records, and persist the domain + records (hint mode by default).
 * Resumable in spirit — Stalwart calls are create-or-update by identifier.
 */
export async function addDomain(
  db: Db,
  config: Env,
  orgId: string,
  instanceId: string,
  input: AddDomainInput,
  deps: MailDeps = {},
): Promise<DomainWithRecords> {
  const instance = await loadInstance(db, orgId, instanceId);
  const fqdn = input.fqdn.trim().toLowerCase();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(fqdn)) {
    throw new AppError("invalid domain", { status: 400, code: "mail.bad_domain" });
  }
  const client = (deps.clientFor ?? defaultClientFor)(instance, config);

  await client.createDomain(fqdn);
  const dkim = await client.generateDkim(fqdn);
  const raw = await client.getDnsRecords(fqdn);
  const normalized = normalizeStalwartRecords(raw);

  const domainId = newId("mld");
  const [domainRow] = await db
    .insert(mailDomains)
    .values({
      id: domainId,
      mailInstanceId: instance.id,
      organizationId: orgId,
      fqdn,
      dkimSelector: dkim.selector,
      dnsMode: input.dnsMode ?? "hint",
      inboxSubdomain: `inbox.${fqdn}`,
    })
    .returning();

  const recordValues = dnsRecordInsertValues(domainId, normalized);
  const recordRows = recordValues.length
    ? await db.insert(mailDnsRecords).values(recordValues).returning()
    : [];

  return { domain: toDomainView(domainRow!), records: recordRows.map(toRecordView) };
}

export async function listDomains(
  db: Db,
  orgId: string,
  instanceId: string,
): Promise<MailDomainView[]> {
  await loadInstance(db, orgId, instanceId); // scope
  const rows = await db
    .select()
    .from(mailDomains)
    .where(and(eq(mailDomains.mailInstanceId, instanceId), eq(mailDomains.organizationId, orgId)))
    .orderBy(asc(mailDomains.fqdn));
  return rows.map(toDomainView);
}

export async function getDomain(db: Db, orgId: string, id: string): Promise<MailDomainView> {
  return toDomainView(await loadDomain(db, orgId, id));
}

export async function getDomainDns(
  db: Db,
  orgId: string,
  domainId: string,
): Promise<MailDnsRecordView[]> {
  await loadDomain(db, orgId, domainId); // scope
  const rows = await db
    .select()
    .from(mailDnsRecords)
    .where(eq(mailDnsRecords.mailDomainId, domainId));
  return rows.map(toRecordView);
}

/** Mark a domain (and its records) for re-verification; the pg-boss job does
 *  the actual DNS lookups and advances the state machine. */
export async function requestVerification(
  db: Db,
  orgId: string,
  domainId: string,
): Promise<MailDomainView> {
  const domain = await loadDomain(db, orgId, domainId);
  await db
    .update(mailDnsRecords)
    .set({ status: "verifying" })
    .where(eq(mailDnsRecords.mailDomainId, domain.id));
  const [row] = await db
    .update(mailDomains)
    .set({ verificationStatus: "verifying", updatedAt: new Date() })
    .where(eq(mailDomains.id, domain.id))
    .returning();
  return toDomainView(row!);
}

// ── Mailboxes ─────────────────────────────────────────────────────────────

export interface CreateMailboxInput {
  localPart: string;
  displayName?: string;
  quotaBytes?: number;
  /** Optional; when omitted a strong password is generated. */
  password?: string;
}

export interface MailboxCreated {
  mailbox: MailboxView;
  /** Shown once; never stored (Stalwart holds only the hash). */
  password: string;
}

export async function createMailbox(
  db: Db,
  config: Env,
  orgId: string,
  domainId: string,
  input: CreateMailboxInput,
  deps: MailDeps = {},
): Promise<MailboxCreated> {
  const domain = await loadDomain(db, orgId, domainId);
  const instance = await loadInstance(db, orgId, domain.mailInstanceId);
  const localPart = input.localPart.trim().toLowerCase();
  if (!/^[a-z0-9._+-]+$/.test(localPart)) {
    throw new AppError("invalid local part", { status: 400, code: "mail.bad_localpart" });
  }
  const password = input.password ?? randomBytes(18).toString("base64url");
  const client = (deps.clientFor ?? defaultClientFor)(instance, config);
  await client.createMailbox({
    email: `${localPart}@${domain.fqdn}`,
    password,
    ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
    ...(input.quotaBytes !== undefined ? { quotaBytes: input.quotaBytes } : {}),
  });

  const [row] = await db
    .insert(mailboxes)
    .values({
      id: newId("mbx"),
      mailDomainId: domain.id,
      organizationId: orgId,
      localPart,
      displayName: input.displayName ?? null,
      quotaBytes: input.quotaBytes ?? null,
    })
    .returning();
  return { mailbox: toMailboxView(row!), password };
}

export async function listMailboxes(
  db: Db,
  orgId: string,
  domainId: string,
): Promise<MailboxView[]> {
  await loadDomain(db, orgId, domainId); // scope
  const rows = await db
    .select()
    .from(mailboxes)
    .where(eq(mailboxes.mailDomainId, domainId))
    .orderBy(asc(mailboxes.localPart));
  return rows.map(toMailboxView);
}

export async function deleteMailbox(
  db: Db,
  config: Env,
  orgId: string,
  id: string,
  deps: MailDeps = {},
): Promise<void> {
  const [box] = await db
    .select()
    .from(mailboxes)
    .where(and(eq(mailboxes.id, id), eq(mailboxes.organizationId, orgId)))
    .limit(1);
  if (!box) throw new NotFoundError("mailbox not found");
  const domain = await loadDomain(db, orgId, box.mailDomainId);
  const instance = await loadInstance(db, orgId, domain.mailInstanceId);
  const client = (deps.clientFor ?? defaultClientFor)(instance, config);
  await client.deleteMailbox(`${box.localPart}@${domain.fqdn}`);
  await db.delete(mailboxes).where(eq(mailboxes.id, id));
}

// ── Aliases ─────────────────────────────────────────────────────────────────

export interface CreateAliasInput {
  alias: string;
  destinations: string[];
}

export async function createAlias(
  db: Db,
  orgId: string,
  domainId: string,
  input: CreateAliasInput,
): Promise<MailAliasView> {
  const domain = await loadDomain(db, orgId, domainId);
  const [row] = await db
    .insert(mailAliases)
    .values({
      id: newId("mal"),
      mailDomainId: domain.id,
      organizationId: orgId,
      alias: input.alias.trim().toLowerCase(),
      destinations: input.destinations,
    })
    .returning();
  return toAliasView(row!);
}

export async function listAliases(
  db: Db,
  orgId: string,
  domainId: string,
): Promise<MailAliasView[]> {
  await loadDomain(db, orgId, domainId); // scope
  const rows = await db
    .select()
    .from(mailAliases)
    .where(eq(mailAliases.mailDomainId, domainId))
    .orderBy(asc(mailAliases.alias));
  return rows.map(toAliasView);
}

export async function deleteAlias(db: Db, orgId: string, id: string): Promise<void> {
  const res = await db
    .delete(mailAliases)
    .where(and(eq(mailAliases.id, id), eq(mailAliases.organizationId, orgId)))
    .returning({ id: mailAliases.id });
  if (res.length === 0) throw new NotFoundError("alias not found");
}
