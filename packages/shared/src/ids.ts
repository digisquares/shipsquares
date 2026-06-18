import { customAlphabet } from "nanoid";

// Lowercase alphanumeric only — safe in URLs, logs, shell, and the MCP surface.
const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
const ID_LENGTH = 21;
const gen = customAlphabet(ALPHABET, ID_LENGTH);

/** Resource → opaque id prefix. An id self-describes its resource (e.g. `app_…`). */
export const ID_PREFIXES = {
  org: "org",
  membership: "mbr",
  user: "usr",
  server: "srv",
  app: "app",
  envVar: "env",
  domain: "dom",
  deployment: "dpl",
  step: "stp",
  accessory: "acc",
  apiKey: "key",
  webhook: "whk",
  notificationChannel: "nch",
  notificationSubscription: "nsub",
  vcsConnection: "vcs",
  vcsAppRegistration: "vca",
  scheduledJob: "job",
  scheduledJobRun: "jrun",
  auditEvent: "aud",
  databaseServer: "dbs",
  database: "db",
  databaseUser: "dbu",
  dbConnection: "dbc",
  backupConfig: "bkc",
  backupRun: "bkp",
  previewEnvironment: "prev",
  registryCredential: "reg",
  catalogService: "svc",
  outboundWebhook: "owh",
  outboundDelivery: "dlv",
  aiSettings: "ai",
  conversation: "conv",
  message: "msg",
  aiMemory: "mem",
  metricAlert: "malert",
  invite: "inv",
  replica: "rpl",
  mailInstance: "mli",
  mailDomain: "mld",
  mailDnsRecord: "mdr",
  mailbox: "mbx",
  mailAlias: "mal",
} as const;

export type IdPrefix = (typeof ID_PREFIXES)[keyof typeof ID_PREFIXES];

/**
 * Generate a prefixed, opaque id, e.g. `newId(ID_PREFIXES.app)` → `app_<21 chars>`.
 * Pass a prefix *value* (the right-hand side of {@link ID_PREFIXES}).
 */
export const newId = (prefix: IdPrefix): string => `${prefix}_${gen()}`;
