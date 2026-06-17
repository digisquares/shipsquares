import { makeMysqlDriver } from "./mysql.js";
import { makePostgresDriver } from "./postgres.js";
import type { ConnectionConfig, DbDriver } from "./types.js";

/** Build the driver for a resolved connection (mariadb resolves to mysql upstream). */
export function makeDriver(config: ConnectionConfig): DbDriver {
  return config.engine === "mysql" ? makeMysqlDriver(config) : makePostgresDriver(config);
}
