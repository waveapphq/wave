/**
 * SQL Plugin Parameters (REQ-3.4.1.6, REQ-5.1.4; SQL-1 to SQL-10).
 */

import { group, output, param, type GroupMeta, type InputParam, type OutputParam, type SecretMaskField } from '../types'
import {
  FAILURE_HANDLING_GROUP,
  failureHandlingGroup,
  failureHandlingOnErrorInput,
  outputCore,
  timeoutInput,
} from './_shared-params'
import { tlsTrustInputs } from './_tls-shared'

const TLS_GROUP = 'TLS / Certificates'
const ADVANCED = 'Advanced'
const FILE_PLACEHOLDER = 'testdata://…, artifact://…, or /abs/path'

const NETWORK = { field: 'database_type', values: ['postgresql', 'mysql', 'oracle', 'mssql'] }
const SQLITE = { field: 'database_type', values: ['sqlite'] }
const RUN = { field: 'operation', values: ['run_sql'] }
const CALL = { field: 'operation', values: ['call_procedure'] }
const LOAD = { field: 'operation', values: ['load_table'] }
const FETCH = { field: 'operation', values: ['run_sql', 'call_procedure'] }
const CHANGE = { field: 'operation', values: ['run_sql', 'load_table'] }
const SOURCE = { field: 'script_type', values: ['source'] }
const FILE = { field: 'script_type', values: ['file'] }
const REPLACE = { field: 'mode', values: ['add_or_replace'] }
const COMMIT = { field: 'commit_each_batch', values: ['true'] }
const TLS_ON = { field: 'tls', values: ['true'] }

const OPERATION_LABELS = { run_sql: 'Run SQL', call_procedure: 'Call procedure', load_table: 'Load table' }
const OPERATION_DESCRIPTION = 'What the block does: run a SQL script, call a stored procedure, or load rows into a table.'
const PORT_DESCRIPTION = "Empty means the database type's default: 5432, 3306, 1521 or 1433."
const TLS_DESCRIPTION = 'Encrypt the connection. On by default for SQL Server.'

// One Port row per network type: each reads its type's default port while blank (SQL-8).
function portInput(databaseType: string, placeholder: string): InputParam {
  return param('port', 'Port', 'integer', false, PORT_DESCRIPTION, {
    showWhen: { field: 'database_type', values: [databaseType] },
    placeholder,
    minimum: 1,
    maximum: 65535,
  })
}

function tlsInput(databaseTypes: string[], defaultValue: boolean): InputParam {
  return param('tls', 'TLS', 'boolean', false, TLS_DESCRIPTION, {
    defaultValue,
    noExpression: true,
    group: TLS_GROUP,
    showWhen: { field: 'database_type', values: databaseTypes },
  })
}

export const groups: Record<string, GroupMeta> = {
  [TLS_GROUP]: group(TLS_GROUP),
  [ADVANCED]: group(ADVANCED),
  [FAILURE_HANDLING_GROUP]: failureHandlingGroup(),
}

export const inputs: InputParam[] = [
  // SQLite has no procedures, so its Operation row offers no Call procedure (SQL-6).
  param('operation', 'Operation', 'string', false, OPERATION_DESCRIPTION, {
    enumValues: ['run_sql', 'call_procedure', 'load_table'],
    enumLabels: OPERATION_LABELS,
    defaultValue: 'run_sql',
    noExpression: true,
    showWhen: NETWORK,
  }),
  param('operation', 'Operation', 'string', false, OPERATION_DESCRIPTION, {
    enumValues: ['run_sql', 'load_table'],
    enumLabels: OPERATION_LABELS,
    defaultValue: 'run_sql',
    noExpression: true,
    showWhen: SQLITE,
  }),
  param('database_type', 'Database type', 'string', false, 'Picks the driver, the dialect the editor checks and suggests, and the default port.', {
    enumValues: ['postgresql', 'mysql', 'oracle', 'mssql', 'sqlite'],
    enumLabels: {
      postgresql: 'PostgreSQL',
      mysql: 'MySQL / MariaDB',
      oracle: 'Oracle',
      mssql: 'SQL Server',
      sqlite: 'SQLite',
    },
    defaultValue: 'postgresql',
    noExpression: true,
  }),
  param('host', 'Host', 'string', false, 'Database server host name or address.', {
    allowedFormats: ['plain'],
    showWhen: NETWORK,
    requiredWhen: NETWORK,
    retainOnHide: true,
  }),
  portInput('postgresql', '5432'),
  portInput('mysql', '3306'),
  portInput('oracle', '1521'),
  portInput('mssql', '1433'),
  param('database', 'Database', 'string', false, 'The database to connect to. On Oracle, the service name.', {
    showWhen: NETWORK,
    requiredWhen: NETWORK,
    retainOnHide: true,
  }),
  param('username', 'Username', 'string', false, 'Login name.', {
    showWhen: NETWORK,
    requiredWhen: NETWORK,
    retainOnHide: true,
  }),
  param('password', 'Password', 'string', false, 'Kept as a secret and masked everywhere.', {
    showWhen: NETWORK,
    secret: true,
    allowedFormats: ['plain'],
    retainOnHide: true,
  }),
  param('file', 'File', 'string', false, 'The SQLite database file: testdata://, artifact:// or an absolute or relative path. A plain path is opened where the block runs.', {
    showWhen: SQLITE,
    requiredWhen: SQLITE,
    fileReference: 'file',
    placeholder: FILE_PLACEHOLDER,
    retainOnHide: true,
  }),
  param('script_type', 'Script Type', 'string', false, 'Type the SQL here or read it from a .sql file.', {
    enumValues: ['source', 'file'],
    enumLabels: { source: 'Source', file: 'File' },
    defaultValue: 'source',
    noExpression: true,
    showWhen: RUN,
  }),
  param('sql', 'SQL', 'string', false, 'One statement or a whole script. Statements end with ; (GO on SQL Server, / after a PL/SQL block on Oracle). Write :name where a value goes and add it to Parameters. With {}, an expression gives the SQL text; :name parameters still bind.', {
    allowedFormats: ['sql'],
    showWhenAll: [RUN, SOURCE],
    requiredWhenAll: [RUN, SOURCE],
    retainOnHide: true,
  }),
  param('sql_file', 'SQL File', 'string', false, 'The .sql file to run: testdata://, artifact:// or an absolute or relative path. A testdata:// or artifact:// file is read on WAVE; a plain path is read where the block runs.', {
    showWhenAll: [RUN, FILE],
    requiredWhenAll: [RUN, FILE],
    fileReference: 'file',
    placeholder: FILE_PLACEHOLDER,
    retainOnHide: true,
  }),
  param('parameters', 'Parameters', 'map', false, 'Values for the :name placeholders. Bound by name, never pasted into the text. Empty text binds as empty text; null binds NULL.', {
    defaultValue: {},
    showWhen: RUN,
    retainOnHide: true,
  }),
  param('stop_on_error', 'Stop on error', 'boolean', false, 'A failing statement stops the script and fails the block. Off: every statement runs, each failure is logged, and the block passes, with a warning when all of them failed.', {
    defaultValue: true,
    showWhen: RUN,
  }),
  param('procedure', 'Procedure', 'string', false, 'The procedure or function to call, with its schema or package when it has one: billing.apply_discount.', {
    showWhen: CALL,
    requiredWhen: CALL,
    retainOnHide: true,
  }),
  param('arguments', 'Arguments', 'map', false, "One entry per argument, in the procedure's own order: the name as the procedure declares it, and the value to pass. Leave the value empty for an out argument.", {
    defaultValue: {},
    showWhen: CALL,
    retainOnHide: true,
  }),
  param('out_arguments', 'Out arguments', 'array', false, 'Names of the arguments the procedure writes back. Each becomes a column of Out values.', {
    defaultValue: [],
    showWhen: CALL,
    orderedList: { itemNoun: 'argument', positionPrefix: '' },
    noExpression: true,
    retainOnHide: true,
  }),
  param('table', 'Table', 'table', false, 'The rows to load: a table variable, or a CSV or Excel file from Test Data or Artifacts chosen with Browse.', {
    showWhen: LOAD,
    requiredWhen: LOAD,
    fileReference: 'file',
    retainOnHide: true,
  }),
  param('target_table', 'Target table', 'string', false, 'The database table to load into. It must exist; the block creates no tables.', {
    showWhen: LOAD,
    requiredWhen: LOAD,
    retainOnHide: true,
  }),
  param('mode', 'Mode', 'string', false, 'Add inserts every row. Add or replace updates a row whose key already exists and inserts the rest. Overwrite empties the table first, in the same transaction.', {
    enumValues: ['add', 'add_or_replace', 'overwrite'],
    enumLabels: { add: 'Add', add_or_replace: 'Add or replace', overwrite: 'Overwrite' },
    defaultValue: 'add',
    noExpression: true,
    showWhen: LOAD,
  }),
  param('key_columns', 'Key columns', 'string', false, "Columns that identify a row, comma-separated. Empty means the table's primary key.", {
    showWhenAll: [LOAD, REPLACE],
    retainOnHide: true,
  }),
  param('commit_each_batch', 'Commit each batch', 'boolean', false, 'Off: one transaction, all rows or none. On: every batch commits on its own.', {
    defaultValue: false,
    noExpression: true,
    showWhen: LOAD,
  }),
  param('stop_on_error', 'Stop on error', 'boolean', false, 'A failing batch stops the load and fails the block; the batches before it stay. Off: the failing batch is skipped and logged, the rest load.', {
    defaultValue: true,
    showWhenAll: [LOAD, COMMIT],
  }),
  timeoutInput(300, 'Seconds for the whole block. When it runs out, the running statement is canceled on the database.'),
  // --- TLS / Certificates: SQLite is a file, so it shows no TLS row ---
  tlsInput(['postgresql', 'mysql', 'oracle'], false),
  tlsInput(['mssql'], true),
  ...tlsTrustInputs(TLS_GROUP).map((row) => ({ ...row, showWhenAll: [NETWORK, TLS_ON] })),
  // --- Advanced ---
  param('connect_timeout', 'Connect timeout', 'integer', false, 'Seconds to wait for the database to accept the connection.', {
    defaultValue: 30,
    minimum: 1,
    group: ADVANCED,
  }),
  param('max_rows', 'Max rows', 'integer', false, 'Rows kept from a result. 0 keeps every row. When the limit is reached the rows so far are kept and the log says so.', {
    defaultValue: 10000,
    minimum: 0,
    group: ADVANCED,
    showWhen: FETCH,
  }),
  param('batch_size', 'Batch size', 'integer', false, 'Rows sent per round trip.', {
    defaultValue: 1000,
    minimum: 1,
    group: ADVANCED,
    showWhen: LOAD,
  }),
  param('driver_options', 'Driver options', 'map', false, "Extra connection options passed to the driver under the driver's own names. See the block's documentation for the common ones per database.", {
    defaultValue: {},
    group: ADVANCED,
    typedValues: true,
  }),
  // --- Failure Handling ---
  failureHandlingOnErrorInput(),
]

const [SUCCESS, ERROR, REASON] = outputCore({
  successDescription: 'True when the operation finished. False when the block failed and On error is Record and continue.',
  reasonDescription: 'Why it failed: Unreachable, AuthFailed, DatabaseError, Timeout, Validation or Unsupported; empty when it passed.',
})

export const outputs: OutputParam[] = [
  SUCCESS,
  output('rows', 'Rows', 'table', 'The rows of the last statement that returned rows, or the rows the procedure returned; an empty table when there were none.', {
    showWhen: FETCH,
  }),
  output('row_count', 'Row count', 'integer', 'How many rows Rows holds.', { showWhen: FETCH }),
  output('rows_changed', 'Rows changed', 'integer', 'Rows the script changed, summed over its statements, or the rows the load committed.', {
    showWhen: CHANGE,
  }),
  output('out_values', 'Out values', 'table', 'One row with a column per out or in-out argument, typed as the database typed it.', {
    showWhen: CALL,
  }),
  ERROR,
  REASON,
]

export const secretMaskFields: SecretMaskField[] = [
  { key: 'password', label: 'Password' },
  { key: 'client_key', label: 'Client Key' },
]
