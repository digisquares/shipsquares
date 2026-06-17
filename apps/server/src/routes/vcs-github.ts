import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type as T } from "@sinclair/typebox";

import * as connectionsService from "../services/connections.service.js";
import { exchangeManifestCode } from "../vcs/github-manifest.js";
import { verifyInstallState } from "../vcs/install-state.js";
import { lookupInstallationAccount } from "../vcs/installation-account.js";
import { createNonceStore } from "../vcs/nonce-store.js";
import { normalizePrivateKey } from "../vcs/private-key.js";
import { openSecretRef, sealSecretRef } from "../vcs/provider-deps.js";

// Public GitHub-App callbacks (26-vcs-connections.md). NOT session-authed: the
// signed, SINGLE-USE state (verifyInstallState + nonce burn) is the auth + CSRF
// guard, and it carries the org. These URLs render in a browser, so failures
// redirect back to Settings with an error code instead of raw problem JSON.
const installNonces = createNonceStore();
const manifestNonces = createNonceStore();

interface RegistrationSecrets {
  privateKey: string;
}

export const vcsGithubRoutes: FastifyPluginAsyncTypebox = async (app) => {
  // Manifest creation callback: GitHub redirects here with a temporary `code`
  // once the user submits the App manifest. Exchange it for the App's
  // credentials and persist a sealed registration for the org.
  app.get(
    "/vcs/github/app/manifest/callback",
    {
      schema: {
        tags: ["vcs"],
        querystring: T.Object({ code: T.Optional(T.String()), state: T.String() }),
      },
    },
    async (req, reply) => {
      const fail = (code: string) => reply.redirect(`/#/settings?error=${code}`);
      const verified = verifyInstallState(req.query.state, app.config.AUTH_SECRET, Date.now());
      if (!verified || verified.action !== "manifest") return fail("invalid_state");
      if (!manifestNonces.consume(verified.nonce, Date.now())) return fail("state_reused");
      if (!req.query.code) return fail("missing_code");

      try {
        const creds = await exchangeManifestCode(req.query.code);
        const credentialsSecretRef = sealSecretRef(
          JSON.stringify({
            privateKey: normalizePrivateKey(creds.privateKey),
            clientId: creds.clientId,
            clientSecret: creds.clientSecret,
            webhookSecret: creds.webhookSecret,
          }),
          app.config,
        );
        await connectionsService.createAppRegistration(app.db, verified.orgId, {
          appId: creds.appId,
          slug: creds.slug,
          name: creds.name,
          htmlUrl: creds.htmlUrl,
          credentialsSecretRef,
        });
      } catch (err) {
        app.log.warn?.({ err }, "github app manifest callback failed");
        return fail("manifest_failed");
      }
      return reply.redirect("/#/settings?github_app=created");
    },
  );

  app.get(
    "/vcs/github/app/callback",
    {
      schema: {
        tags: ["vcs"],
        querystring: T.Object({
          installation_id: T.Optional(T.String({ pattern: "^[0-9]+$" })),
          state: T.String(),
          setup_action: T.Optional(T.String()),
        }),
      },
    },
    async (req, reply) => {
      const fail = (code: string) => reply.redirect(`/#/settings?error=${code}`);

      const verified = verifyInstallState(req.query.state, app.config.AUTH_SECRET, Date.now());
      if (!verified || verified.action === "manifest") return fail("invalid_state");
      if (!installNonces.consume(verified.nonce, Date.now())) return fail("state_reused");

      // An approval-required install (`setup_action=request`) has no installation
      // yet — GitHub calls back again once an owner approves.
      if (req.query.setup_action === "request" || !req.query.installation_id) {
        return reply.redirect("/#/settings?install=pending");
      }

      // Resolve the exact registration being installed (its id rides the signed
      // state — correct for orgs with multiple Apps); fall back to the
      // env-configured shared App (GITHUB_APP_ID/PRIVATE_KEY).
      let appId = app.config.GITHUB_APP_ID;
      let privateKey = normalizePrivateKey(app.config.GITHUB_APP_PRIVATE_KEY ?? "");
      let appRegistrationId: string | null = null;
      if (verified.regId) {
        const reg = await connectionsService.getAppRegistrationById(app.db, verified.regId);
        if (reg && reg.organizationId === verified.orgId) {
          try {
            const creds = JSON.parse(
              openSecretRef(reg.credentialsSecretRef, app.config),
            ) as RegistrationSecrets;
            appId = reg.appId;
            privateKey = normalizePrivateKey(creds.privateKey);
            appRegistrationId = reg.id;
          } catch {
            /* fall back to env-configured app */
          }
        }
      }
      if (!appId || !privateKey) return fail("app_unconfigured");

      try {
        const account = await lookupInstallationAccount(
          appId,
          privateKey,
          req.query.installation_id,
        );
        await connectionsService.upsertGithubAppConnection(app.db, verified.orgId, {
          provider: "github",
          accountLogin: account.login,
          installationId: req.query.installation_id,
          githubAppId: appId,
          // Registration-backed connections reference the shared key (R2.7);
          // the env-app path still seals a per-connection copy.
          tokenSecretRef: appRegistrationId ? null : sealSecretRef(privateKey, app.config),
          appRegistrationId,
        });
      } catch (err) {
        app.log.warn?.({ err }, "github app install callback failed");
        return fail("install_failed");
      }
      return reply.redirect("/#/settings");
    },
  );
};
