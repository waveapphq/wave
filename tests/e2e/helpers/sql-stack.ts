/** SQL fixtures against the database stack: connection rows come from config at load, never the fixture. */

import {
  MARIADB_PORT,
  MSSQL_PORT,
  ORACLE_PORT,
  ORACLE_SERVICE_NAME,
  POSTGRES_PORT,
  SQL_STACK_DATABASE,
  SQL_STACK_PASSWORD,
  SQL_STACK_USER,
  SQL_TARGET_HOST,
  SSH_FIXTURE_HOST_SENTINEL,
} from './config'
import { injectServiceHost } from './fixture-import'

/** The network Database types and the published port of the service behind each. */
export const SQL_DIRECT_PORTS: Readonly<Record<string, string>> = {
  postgresql: POSTGRES_PORT,
  mysql: MARIADB_PORT,
  oracle: ORACLE_PORT,
  mssql: MSSQL_PORT,
}

/** The stack's Database row for a Database type: Oracle takes the service name. */
export function sqlStackDatabase(databaseType: string): string {
  return databaseType === 'oracle' ? ORACLE_SERVICE_NAME : SQL_STACK_DATABASE
}

type NodeLike = { data?: { elementType?: string; config?: { values?: Record<string, unknown> } } }

/** The connection rows a direct-leg SQL Block leaves blank, filled from the stack constants. */
function stackRows(values: Record<string, unknown>): Record<string, unknown> {
  const databaseType = String(values.database_type ?? 'postgresql')
  const port = SQL_DIRECT_PORTS[databaseType]
  if (port === undefined || values.host !== SSH_FIXTURE_HOST_SENTINEL) return values
  return {
    port: Number(port),
    database: sqlStackDatabase(databaseType),
    username: SQL_STACK_USER,
    password: SQL_STACK_PASSWORD,
    ...values,
  }
}

/** A copy whose direct-leg SQL Blocks fill blank connection rows from config and dial SQL_TARGET_HOST. */
export function withSqlStack<T extends Record<string, unknown>>(fixture: T): T {
  const copy = JSON.parse(JSON.stringify(fixture)) as T & {
    workflow?: { nodes?: NodeLike[] }
  }
  for (const node of copy.workflow?.nodes ?? []) {
    const config = node.data?.config
    if (node.data?.elementType === 'sql-client' && config?.values) {
      config.values = stackRows(config.values)
    }
  }
  return injectServiceHost(copy, SQL_TARGET_HOST) as T
}

/** A copy of the fixture whose SQL Blocks with a blank password take the stack's. */
export function withStackPassword<T extends Record<string, unknown>>(fixture: T): T {
  const copy = JSON.parse(JSON.stringify(fixture)) as T & { workflow?: { nodes?: NodeLike[] } }
  for (const node of copy.workflow?.nodes ?? []) {
    const values = node.data?.config?.values
    if (node.data?.elementType === 'sql-client' && values?.password === '') {
      values.password = SQL_STACK_PASSWORD
    }
  }
  return copy
}
