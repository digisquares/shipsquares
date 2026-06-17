import type { DbEngine, QueryFn } from "../engines/types.js";

import { mysqlSchemas, mysqlTableDetail } from "./mysql.js";
import { pgSchemas, pgTableDetail } from "./postgres.js";
import type { SchemaNode, TableDetail } from "./types.js";

export interface EngineIntrospector {
  schemas(q: QueryFn): Promise<SchemaNode[]>;
  tableDetail(q: QueryFn, schema: string, table: string): Promise<TableDetail>;
}

export function introspectorFor(engine: DbEngine): EngineIntrospector {
  return engine === "mysql"
    ? { schemas: mysqlSchemas, tableDetail: mysqlTableDetail }
    : { schemas: pgSchemas, tableDetail: pgTableDetail };
}
