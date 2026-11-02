/**
 * The Get Tables request of a SQL block and its cache key (REQ-3.4.1.6; SQL-12).
 */

import type { SqlCatalogRequest, SqlConnection } from '@/features/workbench/api/sql-tools'
import {
  catalogRequestOf,
  catalogStateKey,
  type CatalogRequestInput,
} from '@/features/workbench/lib/catalog-request'

const CONNECTION_ROWS: ReadonlySet<string> = new Set([
  'database_type',
  'host',
  'port',
  'database',
  'username',
  'password',
  'tls',
  'verify_ssl',
  'ca_cert',
  'client_cert',
  'client_key',
  'driver_options',
  'file',
])

/** The connection rows of a SQL block's values as the block holds them; the server fills every default (REQ-3.4.1.6). */
export function sqlConnectionOf(values: Record<string, unknown>): SqlConnection {
  return {
    database_type: values.database_type,
    host: values.host,
    port: values.port,
    database: values.database,
    username: values.username,
    // A credential row goes as it sits: absent is nothing given, a held null is refused (REQ-3.1.3.21).
    password: values.password,
    tls: values.tls,
    verify_ssl: values.verify_ssl,
    ca_cert: values.ca_cert,
    client_cert: values.client_cert,
    client_key: values.client_key,
    driver_options: values.driver_options,
    file: values.file,
  }
}

/** The whole Get Tables request of a block: its rows plus what the server resolves them with. */
export function sqlCatalogRequestOf(input: CatalogRequestInput): SqlCatalogRequest {
  return catalogRequestOf(input, CONNECTION_ROWS, sqlConnectionOf)
}

/** The key of the Get Tables state editors share: rows differing only in a sealed value's ciphertext share it (SQL-12). */
export function sqlCatalogStateKey(request: SqlCatalogRequest): string {
  return catalogStateKey(request)
}
