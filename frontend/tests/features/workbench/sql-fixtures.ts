/**
 * Shared SQL block fixtures: a loaded catalog, a connection and a script, as the
 * editor, the catalog hook, the completion source and the checks see them.
 *
 * REQ-3.4.1.6: SQL database operations
 */

import type { SqlCatalogRequest, SqlConnection, SqlTable } from '@/features/workbench/api/sql-tools'

export const ORDERS: SqlTable = {
  schema: 'public',
  name: 'orders',
  kind: 'table',
  columns: [
    { name: 'id', type: 'integer' },
    { name: 'customer_id', type: 'integer' },
    { name: 'status', type: 'text' },
    { name: 'total', type: 'numeric' },
    { name: 'created_at', type: 'timestamp' },
  ],
}

export const ORDER_ITEMS: SqlTable = {
  schema: 'public',
  name: 'order_items',
  kind: 'table',
  columns: [
    { name: 'id', type: 'integer' },
    { name: 'order_id', type: 'integer' },
    { name: 'sku', type: 'text' },
    { name: 'qty', type: 'integer' },
    { name: 'price', type: 'numeric' },
  ],
}

// Its name does not hold "ord", one of its columns does: a name-only filter drops it.
export const CUSTOMERS: SqlTable = {
  schema: 'public',
  name: 'customers',
  kind: 'table',
  columns: [
    { name: 'id', type: 'integer' },
    { name: 'name', type: 'text' },
    { name: 'email', type: 'text' },
    { name: 'order_count', type: 'integer' },
  ],
}

export const ACTIVE_CUSTOMERS: SqlTable = {
  schema: 'public',
  name: 'active_customers',
  kind: 'view',
  columns: [
    { name: 'id', type: 'integer' },
    { name: 'email', type: 'text' },
  ],
}

/** Catalog order, as the server answers it. */
export const SAMPLE_TABLES: readonly SqlTable[] = [ORDERS, ORDER_ITEMS, CUSTOMERS, ACTIVE_CUSTOMERS]

/** The connection a PostgreSQL block with literal rows describes. */
export const SAMPLE_CONNECTION: SqlConnection = {
  database_type: 'postgresql',
  host: 'db.lab',
  port: 5432,
  database: 'shop',
  username: 'wave',
  password: 'secret-pw',
  tls: false,
  verify_ssl: true,
  ca_cert: null,
  client_cert: null,
  driver_options: {},
  file: null,
}

/** The Get Tables request of that block: literal rows, no profile, one Environment picked. */
export const SAMPLE_CATALOG_REQUEST: SqlCatalogRequest = {
  connection: SAMPLE_CONNECTION,
  expression_fields: [],
  template_fields: [],
  element_types: {},
  profile_bindings: [],
  environment_id: 'env-lab',
  test_id: 'test-orders',
}

/** The script the editor wireframes show. */
export const SAMPLE_SCRIPT = [
  'SELECT id, status, total',
  'FROM orders',
  'WHERE customer_id = :customer',
  '  AND status = :status',
  'ORDER BY created_at DESC',
].join('\n')
