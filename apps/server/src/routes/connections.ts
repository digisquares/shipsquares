import { randomBytes } from "node:crypto";

import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type as T } from "@sinclair/typebox";
import { AppError } from "@ss/shared";

import { getOrgId } from "../lib/ctx.js";
import { Problem } from "../schemas/common.js";
import * as connectionsService from "../services/connections.service.js";
import * as webhooksService from "../services/webhooks.service.js";
import { toCreateInput } from "../vcs/create-connection.js";
import { githubInstallUrl } from "../vcs/github-install.js";
import {
  buildGithubAppManifest,
  manifestPostUrl,
  renderManifestForm,
} from "../vcs/github-manifest.js";
import { signInstallState } from "../vcs/install-state.js";
import { buildProviderDeps, sealSecretRef } from "../vcs/provider-deps.js";
import { providerFor } from "../vcs/providers/index.js";

// VCS connections REST (26-vcs-connections.md). github_app connections are
// created ONLY by the install callback (routes/vcs-github.ts); POST here is for
// oauth/manual and takes the PLAINTEXT credential, sealed server-side.
// RBAC: webhook:read to list, webhook:write to create/delete.

const Provider = T.Union([
  T.Literal("github"),
  T.Literal("gitlab"),
  T.Literal("gitea"),
  T.Literal("bitbucket"),
  T.Literal("generic"),
]);
const Kind = T.Union([T.Literal("github_app"), T.Literal("oauth"), T.Literal("manual")]);

const VcsConnection = T.Object({
  id: T.String(),
  provider: Provider,
  kind: Kind,
  accountLogin: T.String(),
  installationId: T.Union([T.String(), T.Null()]),
  githubAppId: T.Union([T.String(), T.Null()]),
  createdAt: T.String({ format: "date-time" }),
});

const CreateOauth = T.Object(
  {
    kind: T.Literal("oauth"),
    provider: Provider,
    accountLogin: T.String({ minLength: 1, maxLength: 255 }),
    token: T.String({ minLength: 1 }),
    refreshToken: T.Optional(T.String()),
    expiresAt: T.Optional(T.String({ format: "date-time" })),
  },
  { additionalProperties: false },
);
const CreateManual = T.Object(
  {
    kind: T.Literal("manual"),
    provider: Provider,
    accountLogin: T.String({ minLength: 1, maxLength: 255 }),
    credential: T.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);
// Discriminated on kind; `github_app` has no variant here by design.
const CreateConnection = T.Union([CreateOauth, CreateManual]);

const RepoRef = T.Object({
  owner: T.String(),
  name: T.String(),
  fullName: T.String(),
  defaultBranch: T.String(),
  private: T.Boolean(),
  cloneUrl: T.String(),
});

const BranchRef = T.Object({
  name: T.String(),
  commit: T.String(),
  protected: T.Boolean(),
});

const AppRegistration = T.Object({
  id: T.String(),
  appId: T.String(),
  slug: T.String(),
  name: T.String(),
  htmlUrl: T.Union([T.String(), T.Null()]),
  createdAt: T.String({ format: "date-time" }),
});

const IdParam = T.Object({ id: T.String() });

const RegisterWebhook = T.Object(
  { appId: T.String(), owner: T.String(), name: T.String() },
  { additionalProperties: false },
);
// url + secret let manual setups paste the hook (the secret is returned ONLY
// here, on the rotate that just minted it — same contract as POST /webhook).
const RegisteredWebhook = T.Object({
  remoteId: T.Union([T.String(), T.Null()]),
  manual: T.Boolean(),
  url: T.String(),
  secret: T.String(),
});

export const connectionsRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/vcs-connections",
    {
      schema: { tags: ["vcs"], response: { 200: T.Array(VcsConnection) } },
      preHandler: app.requirePermission("webhook:read"),
    },
    async (req) => connectionsService.listConnections(app.db, getOrgId(req)),
  );

  app.post(
    "/vcs-connections",
    {
      schema: {
        tags: ["vcs"],
        body: CreateConnection,
        response: { 201: VcsConnection, 400: Problem },
      },
      preHandler: app.requirePermission("webhook:write"),
    },
    async (req, reply) => {
      const seal = (plain: string): string => {
        try {
          return sealSecretRef(plain, app.config);
        } catch {
          throw new AppError("connections require SHIPSQUARES_MASTER_KEY", {
            status: 400,
            code: "secrets.unconfigured",
          });
        }
      };
      const created = await connectionsService.createConnection(
        app.db,
        getOrgId(req),
        toCreateInput(req.body, seal),
      );
      reply.code(201);
      return created;
    },
  );

  app.get(
    "/vcs-connections/:id/repos",
    {
      schema: { tags: ["vcs"], params: IdParam, response: { 200: T.Array(RepoRef), 404: Problem } },
      preHandler: app.requirePermission("webhook:read"),
    },
    async (req) => {
      const conn = await connectionsService.getConnection(app.db, getOrgId(req), req.params.id);
      return providerFor(conn.kind, buildProviderDeps(app.config, app.db)).listRepos(conn);
    },
  );

  // Branches for one repo on this connection (repo+branch picker). github_app
  // implements it; other kinds 400 (the UI falls back to the default branch).
  app.get(
    "/vcs-connections/:id/branches",
    {
      schema: {
        tags: ["vcs"],
        params: IdParam,
        querystring: T.Object({
          owner: T.String({ minLength: 1 }),
          repo: T.String({ minLength: 1 }),
        }),
        response: { 200: T.Array(BranchRef), 400: Problem, 404: Problem },
      },
      preHandler: app.requirePermission("webhook:read"),
    },
    async (req) => {
      const conn = await connectionsService.getConnection(app.db, getOrgId(req), req.params.id);
      const provider = providerFor(conn.kind, buildProviderDeps(app.config, app.db));
      if (!provider.listBranches) {
        throw new AppError(`branch listing is not supported for ${conn.kind} connections`, {
          status: 400,
          code: "vcs.branches_unsupported",
        });
      }
      return provider.listBranches(conn, req.query.owner, req.query.repo);
    },
  );

  // Auto-register a push webhook for an app on this connection: ensure the app's
  // inbound webhook (id + secret), then register it remotely on the repo via the
  // provider. Manual connections return {manual:true} (paste it yourself).
  app.post(
    "/vcs-connections/:id/webhooks",
    {
      schema: {
        tags: ["vcs"],
        params: IdParam,
        body: RegisterWebhook,
        response: { 200: RegisteredWebhook, 400: Problem, 404: Problem },
      },
      preHandler: app.requirePermission("webhook:write"),
    },
    async (req) => {
      const orgId = getOrgId(req);
      const conn = await connectionsService.getConnection(app.db, orgId, req.params.id);
      // Remote registration talks to api.github.com — only github connections
      // can auto-register. Manual works for any provider (paste the hook).
      if (conn.kind !== "manual" && conn.provider !== "github") {
        throw new AppError(
          `auto-registration is github-only for now — use a manual connection for ${conn.provider}`,
          { status: 400, code: "vcs.provider_unsupported" },
        );
      }
      const provider = conn.provider === "generic" ? "github" : conn.provider;
      const wh = await webhooksService.ensureWebhook(
        app.db,
        app.config,
        orgId,
        req.body.appId,
        provider,
      );
      const repo = {
        owner: req.body.owner,
        name: req.body.name,
        fullName: `${req.body.owner}/${req.body.name}`,
        defaultBranch: "main",
        private: true,
        cloneUrl: `https://github.com/${req.body.owner}/${req.body.name}.git`,
      };
      const registered = await providerFor(
        conn.kind,
        buildProviderDeps(app.config, app.db),
      ).registerWebhook(conn, repo, {
        ingestUrl: wh.url,
        secret: wh.secret ?? "",
        events: ["push"],
      });
      // Persist the provider-side hook id so removal can target it (R2.2).
      if (registered.remoteId) {
        await webhooksService.setRemoteHookId(app.db, orgId, wh.id, registered.remoteId);
      }
      return { ...registered, url: wh.url, secret: wh.secret ?? "" };
    },
  );

  app.delete(
    "/vcs-connections/:id",
    {
      schema: { tags: ["vcs"], params: IdParam, response: { 204: T.Null(), 404: Problem } },
      preHandler: app.requirePermission("webhook:write"),
    },
    async (req, reply) => {
      await connectionsService.deleteConnection(app.db, getOrgId(req), req.params.id);
      reply.code(204);
      return null;
    },
  );

  // List the GitHub Apps this org created via the manifest flow.
  app.get(
    "/vcs/github/app/registrations",
    {
      schema: { tags: ["vcs"], response: { 200: T.Array(AppRegistration) } },
      preHandler: app.requirePermission("webhook:read"),
    },
    async (req) => connectionsService.listAppRegistrations(app.db, getOrgId(req)),
  );

  // One-click GitHub App creation (manifest flow). Returns a self-submitting HTML
  // form that POSTs the manifest to GitHub; GitHub redirects to the manifest
  // callback with a temporary code we exchange for the App's credentials. The
  // signed state (action=manifest) binds the flow to this org. `org` targets a
  // GitHub org's apps/new (else the user's personal account).
  app.get(
    "/vcs/github/app/manifest/new",
    {
      schema: {
        tags: ["vcs"],
        querystring: T.Object({
          org: T.Optional(T.String()),
          name: T.Optional(T.String({ maxLength: 100 })),
        }),
      },
      preHandler: app.requirePermission("webhook:write"),
    },
    async (req, reply) => {
      const name = req.query.name?.trim() || `ShipSquares-${randomBytes(4).toString("hex")}`;
      const manifest = buildGithubAppManifest({ name, baseUrl: app.config.AUTH_URL });
      const state = signInstallState(
        {
          orgId: getOrgId(req),
          nonce: randomBytes(16).toString("hex"),
          ts: Date.now(),
          action: "manifest",
        },
        app.config.AUTH_SECRET,
      );
      const action = `${manifestPostUrl(req.query.org ?? null)}?state=${encodeURIComponent(state)}`;
      reply.header("content-type", "text/html; charset=utf-8");
      return renderManifestForm(action, manifest);
    },
  );

  // Begin the GitHub App install: sign a CSRF state (org + nonce) and redirect to
  // GitHub. The callback (routes/vcs-github.ts) verifies the state and persists
  // the connection. Uses the org's manifest-created App slug, falling back to the
  // env-configured shared App.
  app.get(
    "/vcs/github/app/install",
    { schema: { tags: ["vcs"] }, preHandler: app.requirePermission("webhook:write") },
    async (req, reply) => {
      const orgId = getOrgId(req);
      const reg = await connectionsService.getOrgAppRegistration(app.db, orgId);
      const slug = reg?.slug ?? app.config.GITHUB_APP_SLUG;
      if (!slug) {
        throw new AppError("no GitHub App configured — create one via the manifest flow first", {
          status: 400,
          code: "vcs.app_unconfigured",
        });
      }
      const state = signInstallState(
        {
          orgId,
          nonce: randomBytes(16).toString("hex"),
          ts: Date.now(),
          action: "install",
          // Bind the install to the exact App being installed so the callback
          // uses its key + links the connection (R2.7); absent → env-app.
          ...(reg ? { regId: reg.id } : {}),
        },
        app.config.AUTH_SECRET,
      );
      return reply.redirect(githubInstallUrl(slug, state));
    },
  );
};
