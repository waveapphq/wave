/**
 * SQL connection helpers: the SQL adapter on the generic catalog request - the 13 connection rows a pull
 * sends as the block holds them (no default copies), the Get Tables request built from them and its shared
 * state key. The generic request and key rules are covered in catalog-request.test.ts.
 *
 * REQ-3.4.1.6, REQ-4.7.6, REQ-4.7.11; SQL-8, SQL-12
 */

import { describe, it, expect } from 'vitest'

import {
  sqlCatalogRequestOf,
  sqlCatalogStateKey,
  sqlConnectionOf,
} from '@/features/workbench/lib/sql-connection'
import type { SqlCatalogRequest } from '@/features/workbench/api/sql-tools'
import { SAMPLE_CATALOG_REQUEST } from '../sql-fixtures'

const CONNECTION_KEYS = [
  'ca_cert',
  'client_cert',
  'client_key',
  'database',
  'database_type',
  'driver_options',
  'file',
  'host',
  'password',
  'port',
  'tls',
  'username',
  'verify_ssl',
]

const SEALED_PASSWORD = 'wave:enc:v1:c2VhbGVkLXBhc3N3b3Jk'
const SEALED_CLIENT_KEY = 'wave:enc:v1:c2VhbGVkLWNsaWVudC1rZXk='

const ORDERS_DB_BINDING = {
  profileId: 'profile-orders-db',
  alias: 'orders_db',
  profileName: 'Orders DB',
  profileType: 'database',
}

/** The values of a Run SQL block on PostgreSQL, with every non-connection row set too. */
const RUN_SQL_VALUES: Record<string, unknown> = {
  operation: 'run_sql',
  database_type: 'postgresql',
  host: 'db.lab',
  port: 5432,
  database: 'shop',
  username: 'wave',
  password: 'secret-pw',
  script_type: 'source',
  sql: 'SELECT 1',
  parameters: { customer: '42' },
  stop_on_error: true,
  timeout: 300,
  tls: false,
  verify_ssl: true,
  connect_timeout: 30,
  max_rows: 10000,
  driver_options: {},
  on_error: 'fail',
}

/** What a pull puts on the wire: a row the connection leaves undefined is not sent. */
function sentRows(connection: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(connection)) as Record<string, unknown>
}

/** The connection rows RUN_SQL_VALUES holds, exactly as the block holds them. */
const RUN_SQL_CONNECTION = {
  database_type: 'postgresql',
  host: 'db.lab',
  port: 5432,
  database: 'shop',
  username: 'wave',
  password: 'secret-pw',
  tls: false,
  verify_ssl: true,
  driver_options: {},
}

describe('sqlConnectionOf', () => {
  it('sends no row when the values hold none: the server fills every default (REQ-3.4.1.6)', () => {
    expect(sentRows(sqlConnectionOf({}))).toEqual({})
  })

  it('leaves out every credential row the block does not hold, so the server reads it as nothing given (REQ-3.1.3.21)', () => {
    const sent = sentRows(sqlConnectionOf({ database_type: 'mssql', host: 'db.lab', username: 'wave' }))

    expect(sent).not.toHaveProperty('password')
    expect(sent).not.toHaveProperty('client_key')
    expect(sent).toEqual({ database_type: 'mssql', host: 'db.lab', username: 'wave' })
  })

  it('sends a credential row holding null as null, so the server refuses it as a run does (REQ-3.1.3.21)', () => {
    const connection = sqlConnectionOf({ password: null, client_key: null })

    expect([connection.password, connection.client_key]).toEqual([null, null])
  })

  it.each(['mssql', 'postgresql', 'mysql', 'oracle', 'sqlite'])(
    'sends no TLS on %s when the block holds none',
    (databaseType) => {
      expect(sentRows(sqlConnectionOf({ database_type: databaseType }))).toEqual({ database_type: databaseType })
    }
  )

  it('sends no database type, Verify Server Certificate or Driver options the block does not hold', () => {
    const sent = sentRows(sqlConnectionOf({ host: 'db.lab' }))

    for (const row of ['database_type', 'verify_ssl', 'driver_options', 'port', 'database', 'file']) {
      expect(sent, row).not.toHaveProperty(row)
    }
  })

  it('keeps the database type as set', () => {
    expect(sqlConnectionOf({ database_type: 'oracle' }).database_type).toBe('oracle')
  })

  it('keeps TLS off when it is turned off on SQL Server', () => {
    expect(sqlConnectionOf({ database_type: 'mssql', tls: false }).tls).toBe(false)
  })

  it('keeps TLS on and Verify Server Certificate off when they are set', () => {
    const connection = sqlConnectionOf({ database_type: 'mysql', tls: true, verify_ssl: false })

    expect(connection.tls).toBe(true)
    expect(connection.verify_ssl).toBe(false)
  })

  it('copies the rows of a literal PostgreSQL block', () => {
    expect(sentRows(sqlConnectionOf(RUN_SQL_VALUES))).toEqual(RUN_SQL_CONNECTION)
  })

  it('copies sealed secrets, expression text, template text and blank rows as they sit', () => {
    const connection = sqlConnectionOf({
      database_type: 'postgresql',
      host: '{{ db_host }}',
      port: '{{ db_port }}',
      database: 'shop_{{ env_suffix }}',
      username: '',
      password: SEALED_PASSWORD,
      tls: true,
      verify_ssl: '{{ verify_tls }}',
      ca_cert: 'testdata://certs/ca.pem',
      client_cert: '',
      client_key: SEALED_CLIENT_KEY,
      driver_options: { sslmode: 'require', application_name: '{{ app_name }}' },
    })

    expect(connection).toEqual({
      database_type: 'postgresql',
      host: '{{ db_host }}',
      port: '{{ db_port }}',
      database: 'shop_{{ env_suffix }}',
      username: '',
      password: SEALED_PASSWORD,
      tls: true,
      verify_ssl: '{{ verify_tls }}',
      ca_cert: 'testdata://certs/ca.pem',
      client_cert: '',
      client_key: SEALED_CLIENT_KEY,
      driver_options: { sslmode: 'require', application_name: '{{ app_name }}' },
    })
  })

  it('copies the File row of a SQLite block and sends no network row', () => {
    const connection = sqlConnectionOf({
      operation: 'load_table',
      database_type: 'sqlite',
      file: 'testdata://fixtures/shop.db',
      table: 'artifact://orders.csv',
      target_table: 'orders',
    })

    expect(sentRows(connection)).toEqual({
      database_type: 'sqlite',
      file: 'testdata://fixtures/shop.db',
    })
  })

  it('carries only the connection rows the block holds and no other value', () => {
    const otherRows = {
      procedure: 'billing.apply_discount',
      arguments: { order_id: '42' },
      batch_size: 1000,
      mode: 'add',
    }
    const everyRow = { ...RUN_SQL_VALUES, ca_cert: '', client_cert: '', client_key: '', file: '', ...otherRows }

    expect(Object.keys(sentRows(sqlConnectionOf(everyRow))).sort()).toEqual(CONNECTION_KEYS)
    expect(Object.keys(sentRows(sqlConnectionOf({ ...RUN_SQL_VALUES, ...otherRows }))).sort()).toEqual(
      Object.keys(RUN_SQL_CONNECTION).sort(),
    )
  })

  it('does not change the values it reads', () => {
    const values = { database_type: 'mssql', host: 'sql.lab' }

    sqlConnectionOf(values)

    expect(values).toEqual({ database_type: 'mssql', host: 'sql.lab' })
  })
})

describe('sqlCatalogRequestOf', () => {
  it('wraps the connection rows with the pull context', () => {
    const request = sqlCatalogRequestOf({
      values: RUN_SQL_VALUES,
      expressionFields: [],
      templateFields: [],
      profileBindings: [],
      environmentId: 'env-lab',
      testId: 'test-orders',
    })

    expect(sentRows(request)).toEqual({ ...SAMPLE_CATALOG_REQUEST, connection: RUN_SQL_CONNECTION })
  })

  it('builds the connection with sqlConnectionOf', () => {
    const values = { database_type: 'mssql', host: '{{ db_host }}', sql: 'SELECT 1' }

    const request = sqlCatalogRequestOf({
      values,
      expressionFields: [],
      templateFields: [],
      profileBindings: [],
      environmentId: null,
      testId: null,
    })

    expect(request.connection).toEqual(sqlConnectionOf(values))
  })

  it('keeps only the connection rows among the expression fields, in their given order', () => {
    const request = sqlCatalogRequestOf({
      values: RUN_SQL_VALUES,
      expressionFields: ['sql', 'port', 'parameters', 'host', 'timeout', 'driver_options'],
      templateFields: [],
      profileBindings: [],
      environmentId: 'env-lab',
      testId: 'test-orders',
    })

    expect(request.expression_fields).toEqual(['port', 'host', 'driver_options'])
  })

  it('keeps a Driver options entry expression beside the connection rows', () => {
    const request = sqlCatalogRequestOf({
      values: RUN_SQL_VALUES,
      expressionFields: ['host', 'driver_options.application_name', 'parameters.min_qty'],
      templateFields: [],
      profileBindings: [],
    })

    expect(request.expression_fields).toEqual(['host', 'driver_options.application_name'])
  })

  it('carries only the connection rows\' element types (REQ-3.1.3.19)', () => {
    const request = sqlCatalogRequestOf({
      values: RUN_SQL_VALUES,
      expressionFields: [],
      templateFields: [],
      profileBindings: [],
      elementTypes: {
        driver_options: { timeout: 'integer', application_name: 'string' },
        parameters: { min_qty: 'integer' },
      },
    })

    expect(request.element_types).toEqual({
      driver_options: { timeout: 'integer', application_name: 'string' },
    })
  })

  it('keeps only the connection rows among the template fields, in their given order', () => {
    const request = sqlCatalogRequestOf({
      values: RUN_SQL_VALUES,
      expressionFields: [],
      templateFields: ['sql', 'database', 'procedure', 'file', 'host'],
      profileBindings: [],
      environmentId: 'env-lab',
      testId: 'test-orders',
    })

    expect(request.template_fields).toEqual(['database', 'file', 'host'])
  })
})

describe('sqlCatalogStateKey (SQL-12)', () => {
  /** Two blocks' requests built from identical rows, each secret sealed on its own. */
  const blockRequest = (password: unknown, clientKey: unknown = null): SqlCatalogRequest =>
    sqlCatalogRequestOf({
      values: { ...RUN_SQL_VALUES, tls: true, password, client_key: clientKey },
      expressionFields: [],
      templateFields: [],
      profileBindings: [ORDERS_DB_BINDING],
      environmentId: 'env-lab',
      testId: 'test-orders',
    })

  it('is equal for two blocks whose identical rows hold a password sealed apart', () => {
    const first = blockRequest('wave:enc:v1:Zmlyc3Qtbm9uY2U=')
    const second = blockRequest('wave:enc:v1:c2Vjb25kLW5vbmNl')

    expect(second.connection.password).not.toBe(first.connection.password)
    expect(sqlCatalogStateKey(second)).toBe(sqlCatalogStateKey(first))
  })

  it('is equal for two blocks whose identical rows hold a client key sealed apart', () => {
    const first = blockRequest(SEALED_PASSWORD, 'wave:enc:v1:a2V5LW9uZQ==')
    const second = blockRequest(SEALED_PASSWORD, 'wave:enc:v1:a2V5LXR3bw==')

    expect(sqlCatalogStateKey(second)).toBe(sqlCatalogStateKey(first))
  })

  it('is the JSON of the whole request for a request that holds no sealed value', () => {
    expect(JSON.parse(sqlCatalogStateKey(SAMPLE_CATALOG_REQUEST))).toEqual(SAMPLE_CATALOG_REQUEST)
  })

  it('keeps a typed password apart from a sealed one', () => {
    expect(sqlCatalogStateKey(blockRequest('secret-pw'))).not.toBe(
      sqlCatalogStateKey(blockRequest(SEALED_PASSWORD)),
    )
  })
})
