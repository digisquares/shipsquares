import { newId, NotFoundError } from "@ss/shared";
import { and, asc, desc, eq } from "drizzle-orm";

import type { Db } from "../db/index.js";
import { vcsAppRegistrations, vcsConnections } from "../db/schema/index.js";
import { isUniqueViolation } from "../lib/db-errors.js";
import { type ConnectionKind, type Provider, type VcsConnection } from "../vcs/types.js";

// Org-scoped CRUD over vcs_connections (26-vcs-connections.md). Cross-org access
// is a not-found, not a forbidden (tenant isolation). The provider layer needs
// the tokenSecretRef, so getConnection returns the full internal shape; the API
// list/create return a view that NEVER exposes the secret ref.

type Row = typeof vcsConnections.$inferSelect;

export interface VcsConnectionView {
  id: string;
  provider: Provider;
  kind: ConnectionKind;
  accountLogin: string;
  installationId: string | null;
  githubAppId: string | null;
  createdAt: string;
}

export function toView(r: Row): VcsConnectionView {
  return {
    id: r.id,
    provider: r.provider,
    kind: r.kind,
    accountLogin: r.accountLogin,
    installationId: r.installationId,
    githubAppId: r.githubAppId,
    createdAt: r.createdAt.toISOString(),
  };
}

export function toConnection(r: Row): VcsConnection {
  return {
    id: r.id,
    organizationId: r.organizationId,
    provider: r.provider,
    kind: r.kind,
    accountLogin: r.accountLogin,
    installationId: r.installationId,
    githubAppId: r.githubAppId,
    tokenSecretRef: r.tokenSecretRef,
    appRegistrationId: r.appRegistrationId,
    tokenExpiresAt: r.tokenExpiresAt ? r.tokenExpiresAt.getTime() : null,
  };
}

export async function listConnections(db: Db, orgId: string): Promise<VcsConnectionView[]> {
  const rows = await db
    .select()
    .from(vcsConnections)
    .where(eq(vcsConnections.organizationId, orgId))
    .orderBy(asc(vcsConnections.createdAt));
  return rows.map(toView);
}

/** Full internal connection (with tokenSecretRef) for the provider layer. */
export async function getConnection(db: Db, orgId: string, id: string): Promise<VcsConnection> {
  const rows = await db
    .select()
    .from(vcsConnections)
    .where(and(eq(vcsConnections.id, id), eq(vcsConnections.organizationId, orgId)))
    .limit(1);
  if (!rows[0]) throw new NotFoundError("connection not found");
  return toConnection(rows[0]);
}

export interface CreateConnectionInput {
  provider: Provider;
  kind: ConnectionKind;
  accountLogin: string;
  installationId?: string | null;
  githubAppId?: string | null;
  tokenSecretRef?: string | null;
}

export async function createConnection(
  db: Db,
  orgId: string,
  input: CreateConnectionInput,
): Promise<VcsConnectionView> {
  const rows = await db
    .insert(vcsConnections)
    .values({
      id: newId("vcs"),
      organizationId: orgId,
      provider: input.provider,
      kind: input.kind,
      accountLogin: input.accountLogin,
      installationId: input.installationId ?? null,
      githubAppId: input.githubAppId ?? null,
      tokenSecretRef: input.tokenSecretRef ?? null,
    })
    .returning();
  return toView(rows[0]!);
}

export interface GithubAppConnectionInput {
  provider: Provider;
  accountLogin: string;
  installationId: string;
  githubAppId: string;
  /** Set for the env-configured shared App (key sealed per-connection); null
   *  when the connection references a registration's key (R2.7). */
  tokenSecretRef: string | null;
  /** Set when the key lives in a vcs_app_registrations row (manifest App). */
  appRegistrationId?: string | null;
}

/** Idempotent install-callback persistence: one connection per
 *  (org, installation) — a re-install / replayed callback UPDATES the existing
 *  row instead of inserting a duplicate. The partial unique index
 *  `vcs_connections_org_installation` backstops the find-then-insert race. */
export async function upsertGithubAppConnection(
  db: Db,
  orgId: string,
  input: GithubAppConnectionInput,
): Promise<VcsConnectionView> {
  const update = async (): Promise<VcsConnectionView | null> => {
    const rows = await db
      .update(vcsConnections)
      .set({
        accountLogin: input.accountLogin,
        githubAppId: input.githubAppId,
        tokenSecretRef: input.tokenSecretRef,
        appRegistrationId: input.appRegistrationId ?? null,
      })
      .where(
        and(
          eq(vcsConnections.organizationId, orgId),
          eq(vcsConnections.installationId, input.installationId),
        ),
      )
      .returning();
    return rows[0] ? toView(rows[0]) : null;
  };

  const existing = await update();
  if (existing) return existing;
  try {
    const rows = await db
      .insert(vcsConnections)
      .values({
        id: newId("vcs"),
        organizationId: orgId,
        provider: input.provider,
        kind: "github_app",
        accountLogin: input.accountLogin,
        installationId: input.installationId,
        githubAppId: input.githubAppId,
        tokenSecretRef: input.tokenSecretRef,
        appRegistrationId: input.appRegistrationId ?? null,
      })
      .returning();
    return toView(rows[0]!);
  } catch (err) {
    if (isUniqueViolation(err)) {
      const raced = await update(); // lost the race — the row exists now
      if (raced) return raced;
    }
    throw err;
  }
}

/** Write back a rotated OAuth credential (already sealed) + its expiry. Internal:
 *  callers hold a connection resolved org-scoped via getConnection. */
export async function persistOauthCredential(
  db: Db,
  connectionId: string,
  tokenSecretRef: string,
  expiresAtMs: number | null,
): Promise<void> {
  await db
    .update(vcsConnections)
    .set({ tokenSecretRef, tokenExpiresAt: expiresAtMs != null ? new Date(expiresAtMs) : null })
    .where(eq(vcsConnections.id, connectionId));
}

export async function deleteConnection(db: Db, orgId: string, id: string): Promise<void> {
  const rows = await db
    .delete(vcsConnections)
    .where(and(eq(vcsConnections.id, id), eq(vcsConnections.organizationId, orgId)))
    .returning({ id: vcsConnections.id });
  if (!rows[0]) throw new NotFoundError("connection not found");
}

// ── GitHub App registrations (manifest flow) ────────────────────────────────
// A registration is the App identity an org created via the manifest flow. Its
// sealed credentials drive the install redirect (slug), the install-callback
// token seal (appId+privateKey), and the app-level webhook (webhookSecret).

type RegRow = typeof vcsAppRegistrations.$inferSelect;

export interface AppRegistrationView {
  id: string;
  appId: string;
  slug: string;
  name: string;
  htmlUrl: string | null;
  createdAt: string;
}

/** Public view — NEVER includes credentialsSecretRef. */
export function toRegistrationView(r: RegRow): AppRegistrationView {
  return {
    id: r.id,
    appId: r.appId,
    slug: r.slug,
    name: r.name,
    htmlUrl: r.htmlUrl,
    createdAt: r.createdAt.toISOString(),
  };
}

export interface CreateAppRegistrationInput {
  appId: string;
  slug: string;
  name: string;
  htmlUrl?: string | null;
  /** Already-sealed JSON of {privateKey, clientId, clientSecret, webhookSecret}. */
  credentialsSecretRef: string;
}

export async function createAppRegistration(
  db: Db,
  orgId: string,
  input: CreateAppRegistrationInput,
): Promise<AppRegistrationView> {
  const rows = await db
    .insert(vcsAppRegistrations)
    .values({
      id: newId("vca"),
      organizationId: orgId,
      provider: "github",
      appId: input.appId,
      slug: input.slug,
      name: input.name,
      htmlUrl: input.htmlUrl ?? null,
      credentialsSecretRef: input.credentialsSecretRef,
    })
    .returning();
  return toRegistrationView(rows[0]!);
}

export async function listAppRegistrations(db: Db, orgId: string): Promise<AppRegistrationView[]> {
  const rows = await db
    .select()
    .from(vcsAppRegistrations)
    .where(eq(vcsAppRegistrations.organizationId, orgId))
    .orderBy(desc(vcsAppRegistrations.createdAt));
  return rows.map(toRegistrationView);
}

/** The org's most-recently-created App, used to drive the install redirect +
 *  install-callback token seal. Full row (with credentialsSecretRef). */
export async function getOrgAppRegistration(db: Db, orgId: string): Promise<RegRow | null> {
  const rows = await db
    .select()
    .from(vcsAppRegistrations)
    .where(eq(vcsAppRegistrations.organizationId, orgId))
    .orderBy(desc(vcsAppRegistrations.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

/** Resolve a registration by its (globally-unique) GitHub App id — used by the
 *  app-level webhook to find the org + sealed webhook secret. */
export async function findAppRegistrationByAppId(db: Db, appId: string): Promise<RegRow | null> {
  const rows = await db
    .select()
    .from(vcsAppRegistrations)
    .where(eq(vcsAppRegistrations.appId, appId))
    .limit(1);
  return rows[0] ?? null;
}

/** Resolve a registration by id — used by the token path to read a
 *  connection's shared key (the connection's appRegistrationId FK already
 *  scopes it to the org). */
export async function getAppRegistrationById(db: Db, id: string): Promise<RegRow | null> {
  const rows = await db
    .select()
    .from(vcsAppRegistrations)
    .where(eq(vcsAppRegistrations.id, id))
    .limit(1);
  return rows[0] ?? null;
}
