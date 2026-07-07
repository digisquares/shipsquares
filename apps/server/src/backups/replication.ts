// Logical-replication command composition (ROADMAP R5.1). Pure SQL builders:
// a PUBLICATION on the primary + a SUBSCRIPTION on the replica is the simplest
// robust mirror for the managed/default PG (no base-backup dance, works
// cross-version). The service runs these via psql over the 24 admin
// connection; identifiers are derived from the replica id and sanitized so
// they can never break the statement, and the conninfo password is
// single-quote-escaped for the SQL string literal.

export interface ReplicaTarget {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

function safeSuffix(replicaId: string): string {
  return replicaId.toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

export const publicationName = (id: string): string => `ss_pub_${safeSuffix(id)}`;
export const subscriptionName = (id: string): string => `ss_sub_${safeSuffix(id)}`;
export const slotName = (id: string): string => `ss_slot_${safeSuffix(id)}`;

/** Quote one libpq conninfo value: always single-quote it, backslash-escaping
 *  `\` and `'` inside. Without this a value containing a space, quote, or
 *  `keyword=` would break conninfo parsing or inject params (the SQL-literal
 *  escaping in createSubscriptionSql only guards the outer SQL layer, not libpq's
 *  own tokenizer). */
function libpqQuote(v: string | number): string {
  return `'${String(v).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

/** libpq keyword/value conninfo for the primary (used inside CONNECTION '…').
 *  Every value is libpq-quoted so arbitrary passwords/users are safe. */
export function replicationConnString(t: ReplicaTarget): string {
  return [
    `host=${libpqQuote(t.host)}`,
    `port=${libpqQuote(t.port)}`,
    `user=${libpqQuote(t.user)}`,
    `password=${libpqQuote(t.password)}`,
    `dbname=${libpqQuote(t.database)}`,
  ].join(" ");
}

export function createPublicationSql(replicaId: string): string {
  return `CREATE PUBLICATION "${publicationName(replicaId)}" FOR ALL TABLES;`;
}

export function dropPublicationSql(replicaId: string): string {
  return `DROP PUBLICATION IF EXISTS "${publicationName(replicaId)}";`;
}

/** CREATE SUBSCRIPTION on the replica, pointing at the primary's publication.
 *  The conninfo is embedded as a SQL string literal (single quotes doubled). */
export function createSubscriptionSql(replicaId: string, primary: ReplicaTarget): string {
  const conn = replicationConnString(primary).replaceAll("'", "''");
  return (
    `CREATE SUBSCRIPTION "${subscriptionName(replicaId)}" ` +
    `CONNECTION '${conn}' PUBLICATION "${publicationName(replicaId)}";`
  );
}

export function dropSubscriptionSql(replicaId: string): string {
  return `DROP SUBSCRIPTION IF EXISTS "${subscriptionName(replicaId)}";`;
}
