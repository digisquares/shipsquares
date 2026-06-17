// Connection-string assembly for provisioned databases (24-database-servers.md).
// The password is URL-encoded so special characters can't break the URL or leak
// structure; SSL is required by default.

export interface ConnectionInput {
  user: string;
  password: string;
  host: string;
  port?: number;
  database: string;
  ssl?: boolean;
}

export function buildConnectionString(input: ConnectionInput): string {
  const port = input.port ?? 5432;
  const user = encodeURIComponent(input.user);
  const password = encodeURIComponent(input.password);
  const database = encodeURIComponent(input.database);
  const query = input.ssl === false ? "" : "?sslmode=require";
  return `postgres://${user}:${password}@${input.host}:${port}/${database}${query}`;
}
