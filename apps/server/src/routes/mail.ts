import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type as T } from "@sinclair/typebox";

import { getOrgId } from "../lib/ctx.js";
import { Problem } from "../schemas/common.js";
import * as mail from "../services/mail.service.js";

// Managed-email REST (R9 · mail/01-architecture.md). Single pane of glass over
// Stalwart's management API: the browser never holds a mail credential and never
// touches Stalwart's WebAdmin — every action re-enters here. RBAC: mail:read for
// views, mail:write for domains/mailboxes/aliases, mail:admin for the instance.
// Mutations are audited automatically by the onResponse hook (plugins/audit.ts).

const InstanceView = T.Object({
  id: T.String(),
  catalogServiceId: T.String(),
  serverId: T.String(),
  hostname: T.String(),
  storeBackend: T.String(),
  status: T.String(),
  port25Egress: T.String(),
  ptrOk: T.Union([T.Boolean(), T.Null()]),
  createdAt: T.String(),
});

const DomainView = T.Object({
  id: T.String(),
  mailInstanceId: T.String(),
  fqdn: T.String(),
  dkimSelector: T.String(),
  dnsMode: T.String(),
  verificationStatus: T.String(),
  inboxSubdomain: T.String(),
  createdAt: T.String(),
});

const DnsRecordView = T.Object({
  id: T.String(),
  kind: T.String(),
  name: T.String(),
  type: T.String(),
  value: T.String(),
  priority: T.Union([T.Integer(), T.Null()]),
  status: T.String(),
  detail: T.Union([T.String(), T.Null()]),
});

const DomainWithRecords = T.Object({ domain: DomainView, records: T.Array(DnsRecordView) });

const MailboxView = T.Object({
  id: T.String(),
  mailDomainId: T.String(),
  localPart: T.String(),
  displayName: T.Union([T.String(), T.Null()]),
  quotaBytes: T.Union([T.Integer(), T.Null()]),
  status: T.String(),
  createdAt: T.String(),
});
const MailboxCreated = T.Object({ mailbox: MailboxView, password: T.String() });

const AliasView = T.Object({
  id: T.String(),
  alias: T.String(),
  destinations: T.Array(T.String()),
  createdAt: T.String(),
});

const ProvisionInstance = T.Object(
  {
    catalogServiceId: T.String({ minLength: 1 }),
    serverId: T.String({ minLength: 1 }),
    hostname: T.String({ minLength: 1, maxLength: 253 }),
    adminSecret: T.String({ minLength: 1, maxLength: 1024 }),
    storeBackend: T.Optional(T.Union([T.Literal("managed_pg"), T.Literal("filesystem")])),
    metadataDbId: T.Optional(T.String()),
  },
  { additionalProperties: false },
);

const AddDomain = T.Object(
  {
    fqdn: T.String({ minLength: 3, maxLength: 253 }),
    dnsMode: T.Optional(T.Union([T.Literal("auto"), T.Literal("hint")])),
  },
  { additionalProperties: false },
);

const CreateMailbox = T.Object(
  {
    localPart: T.String({ minLength: 1, maxLength: 64 }),
    displayName: T.Optional(T.String({ maxLength: 200 })),
    quotaBytes: T.Optional(T.Integer({ minimum: 0 })),
    password: T.Optional(T.String({ minLength: 8, maxLength: 1024 })),
  },
  { additionalProperties: false },
);

const CreateAlias = T.Object(
  {
    alias: T.String({ minLength: 1, maxLength: 64 }),
    destinations: T.Array(T.String({ minLength: 3, maxLength: 320 }), {
      minItems: 1,
      maxItems: 50,
    }),
  },
  { additionalProperties: false },
);

const IdParam = T.Object({ id: T.String() });

export const mailRoutes: FastifyPluginAsyncTypebox = async (app) => {
  // ── Instances ──
  app.get(
    "/mail/instances",
    {
      schema: { tags: ["mail"], response: { 200: T.Array(InstanceView) } },
      preHandler: app.requirePermission("mail:read"),
    },
    async (req) => mail.listInstances(app.db, getOrgId(req)),
  );

  app.post(
    "/mail/instances",
    {
      schema: {
        tags: ["mail"],
        body: ProvisionInstance,
        response: { 201: InstanceView, 404: Problem },
      },
      preHandler: app.requirePermission("mail:admin"),
    },
    async (req, reply) => {
      const created = await mail.provisionInstance(app.db, app.config, getOrgId(req), req.body);
      reply.code(201);
      return created;
    },
  );

  app.get(
    "/mail/instances/:id",
    {
      schema: { tags: ["mail"], params: IdParam, response: { 200: InstanceView, 404: Problem } },
      preHandler: app.requirePermission("mail:read"),
    },
    async (req) => mail.getInstance(app.db, getOrgId(req), req.params.id),
  );

  // ── Domains ──
  app.get(
    "/mail/instances/:id/domains",
    {
      schema: {
        tags: ["mail"],
        params: IdParam,
        response: { 200: T.Array(DomainView), 404: Problem },
      },
      preHandler: app.requirePermission("mail:read"),
    },
    async (req) => mail.listDomains(app.db, getOrgId(req), req.params.id),
  );

  app.post(
    "/mail/instances/:id/domains",
    {
      schema: {
        tags: ["mail"],
        params: IdParam,
        body: AddDomain,
        response: { 201: DomainWithRecords, 400: Problem, 404: Problem },
      },
      preHandler: app.requirePermission("mail:write"),
    },
    async (req, reply) => {
      const created = await mail.addDomain(
        app.db,
        app.config,
        getOrgId(req),
        req.params.id,
        req.body,
      );
      reply.code(201);
      return created;
    },
  );

  app.get(
    "/mail/domains/:id",
    {
      schema: { tags: ["mail"], params: IdParam, response: { 200: DomainView, 404: Problem } },
      preHandler: app.requirePermission("mail:read"),
    },
    async (req) => mail.getDomain(app.db, getOrgId(req), req.params.id),
  );

  app.get(
    "/mail/domains/:id/dns",
    {
      schema: {
        tags: ["mail"],
        params: IdParam,
        response: { 200: T.Array(DnsRecordView), 404: Problem },
      },
      preHandler: app.requirePermission("mail:read"),
    },
    async (req) => mail.getDomainDns(app.db, getOrgId(req), req.params.id),
  );

  app.post(
    "/mail/domains/:id/verify",
    {
      schema: { tags: ["mail"], params: IdParam, response: { 200: DomainView, 404: Problem } },
      preHandler: app.requirePermission("mail:write"),
    },
    async (req) => mail.requestVerification(app.db, getOrgId(req), req.params.id),
  );

  // ── Mailboxes ──
  app.get(
    "/mail/domains/:id/mailboxes",
    {
      schema: {
        tags: ["mail"],
        params: IdParam,
        response: { 200: T.Array(MailboxView), 404: Problem },
      },
      preHandler: app.requirePermission("mail:read"),
    },
    async (req) => mail.listMailboxes(app.db, getOrgId(req), req.params.id),
  );

  app.post(
    "/mail/domains/:id/mailboxes",
    {
      schema: {
        tags: ["mail"],
        params: IdParam,
        body: CreateMailbox,
        response: { 201: MailboxCreated, 400: Problem, 404: Problem },
      },
      preHandler: app.requirePermission("mail:write"),
    },
    async (req, reply) => {
      const created = await mail.createMailbox(
        app.db,
        app.config,
        getOrgId(req),
        req.params.id,
        req.body,
      );
      reply.code(201);
      return created;
    },
  );

  app.delete(
    "/mail/mailboxes/:id",
    {
      schema: { tags: ["mail"], params: IdParam, response: { 204: T.Null(), 404: Problem } },
      preHandler: app.requirePermission("mail:write"),
    },
    async (req, reply) => {
      await mail.deleteMailbox(app.db, app.config, getOrgId(req), req.params.id);
      reply.code(204);
      return null;
    },
  );

  // ── Aliases ──
  app.get(
    "/mail/domains/:id/aliases",
    {
      schema: {
        tags: ["mail"],
        params: IdParam,
        response: { 200: T.Array(AliasView), 404: Problem },
      },
      preHandler: app.requirePermission("mail:read"),
    },
    async (req) => mail.listAliases(app.db, getOrgId(req), req.params.id),
  );

  app.post(
    "/mail/domains/:id/aliases",
    {
      schema: {
        tags: ["mail"],
        params: IdParam,
        body: CreateAlias,
        response: { 201: AliasView, 404: Problem },
      },
      preHandler: app.requirePermission("mail:write"),
    },
    async (req, reply) => {
      const created = await mail.createAlias(app.db, getOrgId(req), req.params.id, req.body);
      reply.code(201);
      return created;
    },
  );

  app.delete(
    "/mail/aliases/:id",
    {
      schema: { tags: ["mail"], params: IdParam, response: { 204: T.Null(), 404: Problem } },
      preHandler: app.requirePermission("mail:write"),
    },
    async (req, reply) => {
      await mail.deleteAlias(app.db, getOrgId(req), req.params.id);
      reply.code(204);
      return null;
    },
  );
};
