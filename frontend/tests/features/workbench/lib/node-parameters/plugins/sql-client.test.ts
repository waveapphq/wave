/**
 * SQL descriptor tests (REQ-3.4.1.6, REQ-5.1.4, REQ-4.7.11).
 *
 * Design decisions: SQL-1, SQL-3, SQL-4, SQL-6, SQL-7, SQL-8, SQL-9, SQL-10, SQL-15
 */

import { describe, it, expect } from 'vitest'
import { Database } from 'lucide-react'
import {
  PLUGIN_INPUTS,
  PLUGIN_OUTPUTS,
  PLUGIN_GROUPS,
  SECRET_MASK_FIELDS,
  getInputParams,
  getOutputParams,
  getGroupMeta,
  getSecretMaskFields,
  hasNodeParams,
} from '@/features/workbench/lib/node-parameters'
import {
  type GroupMeta,
  type InputParam,
  type OutputParam,
  type SecretMaskField,
} from '@/features/workbench/lib/node-parameters/types'
import {
  FAILURE_HANDLING_GROUP,
  failureHandlingGroup,
  failureHandlingOnErrorInput,
  outputCore,
  timeoutInput,
} from '@/features/workbench/lib/node-parameters/plugins/_shared-params'
import {
  deriveGroups,
  isParameterVisible,
  matchesCondition,
  type Parameter,
} from '@/features/workbench/common/element-config/parameters/parameter-table-types'
import { getPluginById } from '@/features/workbench/lib/plugin-definitions'
import {
  getIcon,
  getIconName,
  getColorClass,
} from '@/features/workbench/common/canvas/workflow-node/icon-registry'

const ID = 'sql-client'
const SQL_MODULE = '@/features/workbench/lib/node-parameters/plugins/sql-client'
const TLS_SHARED_MODULE = '@/features/workbench/lib/node-parameters/plugins/_tls-shared'
const REGISTRY_MODULE = '@/features/workbench/lib/node-parameters'
const PYTHON = 'python'
const TLS_GROUP = 'TLS / Certificates'
const ADVANCED = 'Advanced'
const FILE_PLACEHOLDER = 'testdata://…, artifact://…, or /abs/path'
const TLS_ON = { field: 'tls', values: ['true'] }
const DESCRIPTOR_COUNT = 38
const OUTPUT_COUNT = 7

const DATABASE_TYPES = ['postgresql', 'mysql', 'oracle', 'mssql', 'sqlite']
const NETWORK_TYPES = ['postgresql', 'mysql', 'oracle', 'mssql']
const OPERATIONS = ['run_sql', 'call_procedure', 'load_table']

interface ExpectedRow {
  name: string
  label: string
  type: InputParam['type']
  defaultValue: unknown
  noExpression: true | undefined
  group: string | undefined
}

function row(
  name: string,
  label: string,
  type: InputParam['type'],
  defaultValue: unknown,
  noExpression: true | undefined,
  group?: string,
): ExpectedRow {
  return { name, label, type, defaultValue, noExpression, group }
}

/** The 38 descriptors in sheet order; Operation, Port, Stop on error and TLS are twins. */
const EXPECTED: ExpectedRow[] = [
  row('operation', 'Operation', 'string', 'run_sql', true),
  row('operation', 'Operation', 'string', 'run_sql', true),
  row('database_type', 'Database type', 'string', 'postgresql', true),
  row('host', 'Host', 'string', undefined, undefined),
  row('port', 'Port', 'integer', undefined, undefined),
  row('port', 'Port', 'integer', undefined, undefined),
  row('port', 'Port', 'integer', undefined, undefined),
  row('port', 'Port', 'integer', undefined, undefined),
  row('database', 'Database', 'string', undefined, undefined),
  row('username', 'Username', 'string', undefined, undefined),
  row('password', 'Password', 'string', undefined, undefined),
  row('file', 'File', 'string', undefined, undefined),
  row('script_type', 'Script Type', 'string', 'source', true),
  row('sql', 'SQL', 'string', undefined, undefined),
  row('sql_file', 'SQL File', 'string', undefined, undefined),
  row('parameters', 'Parameters', 'map', {}, undefined),
  row('stop_on_error', 'Stop on error', 'boolean', true, undefined),
  row('procedure', 'Procedure', 'string', undefined, undefined),
  row('arguments', 'Arguments', 'map', {}, undefined),
  row('out_arguments', 'Out arguments', 'array', [], true),
  row('table', 'Table', 'table', undefined, undefined),
  row('target_table', 'Target table', 'string', undefined, undefined),
  row('mode', 'Mode', 'string', 'add', true),
  row('key_columns', 'Key columns', 'string', undefined, undefined),
  row('commit_each_batch', 'Commit each batch', 'boolean', false, true),
  row('stop_on_error', 'Stop on error', 'boolean', true, undefined),
  row('timeout', 'Timeout', 'integer', 300, undefined),
  row('tls', 'TLS', 'boolean', false, true, TLS_GROUP),
  row('tls', 'TLS', 'boolean', true, true, TLS_GROUP),
  row('verify_ssl', 'Verify Server Certificate', 'boolean', true, undefined, TLS_GROUP),
  row('ca_cert', 'CA Certificate', 'string', undefined, undefined, TLS_GROUP),
  row('client_cert', 'Client Certificate', 'string', undefined, undefined, TLS_GROUP),
  row('client_key', 'Client Key', 'string', undefined, undefined, TLS_GROUP),
  row('connect_timeout', 'Connect timeout', 'integer', 30, undefined, ADVANCED),
  row('max_rows', 'Max rows', 'integer', 10000, undefined, ADVANCED),
  row('batch_size', 'Batch size', 'integer', 1000, undefined, ADVANCED),
  row('driver_options', 'Driver options', 'map', {}, undefined, ADVANCED),
  row('on_error', 'On error', 'string', 'fail', true, FAILURE_HANDLING_GROUP),
]

// ---------------------------------------------------------------------------
// Helpers over the registry and the functions the sheet itself uses
// ---------------------------------------------------------------------------

function inputs(): InputParam[] {
  return getInputParams(ID) ?? []
}

function outputs(): OutputParam[] {
  return getOutputParams(ID) ?? []
}

function table(): Parameter[] {
  return inputs() as unknown as Parameter[]
}

function inputsNamed(name: string): InputParam[] {
  return inputs().filter((p) => p.name === name)
}

/** The one descriptor under a wire name; fails the test when there is not exactly one. */
function single(name: string): InputParam {
  const rows = inputsNamed(name)
  expect(rows, `descriptors named ${name}`).toHaveLength(1)
  return rows[0]
}

/** The descriptors under a twin wire name, in sheet order; fails the test on the wrong count. */
function twins(name: string, count: number): InputParam[] {
  const rows = inputsNamed(name)
  expect(rows, `descriptors named ${name}`).toHaveLength(count)
  return rows
}

function label(entry: { name: string; label?: string }): string {
  return entry.label ?? entry.name
}

function optionLabels(entry: InputParam): string[] {
  return (entry.enumValues ?? []).map((v) => entry.enumLabels?.[v] ?? String(v))
}

const GATE_KEYS = new Set(['showWhen', 'showWhenAll', 'showWhenAny'])

/** A descriptor without its visibility gates. */
function withoutGates(entry: InputParam): Record<string, unknown> {
  return Object.fromEntries(Object.entries(entry).filter(([key]) => !GATE_KEYS.has(key)))
}

async function loadTlsTrustInputs(): Promise<(group: string) => InputParam[]> {
  const shared = (await import(/* @vite-ignore */ TLS_SHARED_MODULE)) as {
    tlsTrustInputs: (group: string) => InputParam[]
  }
  return shared.tlsTrustInputs
}

/** The descriptors the INPUT table renders for one set of values, in order. */
function visibleRows(values: Record<string, unknown>): InputParam[] {
  const all = table()
  return inputs().filter((_, i) => isParameterVisible(all[i], values, all))
}

function visibleNamed(name: string, values: Record<string, unknown>): InputParam[] {
  return visibleRows(values).filter((p) => p.name === name)
}

/** The sheet as the table derives it: ungrouped labels, then each rendered group with its labels. */
function sheet(values: Record<string, unknown>) {
  const { ungrouped, groups } = deriveGroups(
    visibleRows(values) as unknown as Parameter[],
    getGroupMeta(ID),
  )
  return {
    top: ungrouped.map(label),
    groupOrder: groups.map((g) => g.name),
    group: (name: string) => groups.find((g) => g.name === name)?.params.map(label) ?? [],
  }
}

/** Mirrors the private required resolution (required, requiredWhen, requiredWhenAll) with the exported matcher. */
function requiredFor(entry: InputParam, values: Record<string, unknown>): boolean {
  const all = table()
  if (entry.required) return true
  if (entry.requiredWhen) return matchesCondition(entry.requiredWhen, values, all)
  if (entry.requiredWhenAll) {
    return entry.requiredWhenAll.every((c) => matchesCondition(c, values, all))
  }
  return false
}

function requiredNames(values: Record<string, unknown>): string[] {
  return [...new Set(inputs().filter((p) => requiredFor(p, values)).map((p) => p.name))]
}

/** The outputs the OUTPUT table offers for one set of values. */
function visibleOutputs(values: Record<string, unknown>): string[] {
  const all = table()
  return outputs()
    .filter((o) => isParameterVisible(o, values, all))
    .map((o) => o.name)
}

// ---------------------------------------------------------------------------
// The sheet states
// ---------------------------------------------------------------------------

const NETWORK_HEAD = ['Operation', 'Database type', 'Host', 'Port', 'Database', 'Username', 'Password']
const SQLITE_HEAD = ['Operation', 'Database type', 'File']
const RUN_SOURCE = ['Script Type', 'SQL', 'Parameters', 'Stop on error']
const RUN_FILE = ['Script Type', 'SQL File', 'Parameters', 'Stop on error']
const CALL = ['Procedure', 'Arguments', 'Out arguments']
const LOAD_ADD = ['Table', 'Target table', 'Mode', 'Commit each batch']
const LOAD_REPLACE = ['Table', 'Target table', 'Mode', 'Key columns', 'Commit each batch']
const LOAD_REPLACE_COMMIT = [...LOAD_REPLACE, 'Stop on error']
const LOAD_ADD_COMMIT = [...LOAD_ADD, 'Stop on error']
const TLS_OFF_ROWS = ['TLS']
const TLS_ON_ROWS = ['TLS', 'Verify Server Certificate', 'CA Certificate', 'Client Certificate', 'Client Key']
const ADV_FETCH = ['Connect timeout', 'Max rows', 'Driver options']
const ADV_LOAD = ['Connect timeout', 'Batch size', 'Driver options']
const GROUP_ORDER = [TLS_GROUP, ADVANCED, FAILURE_HANDLING_GROUP]
const SQLITE_GROUP_ORDER = [ADVANCED, FAILURE_HANDLING_GROUP]
const TRUST_NAMES = ['verify_ssl', 'ca_cert', 'client_cert', 'client_key']
const NETWORK_REQUIRED = ['host', 'database', 'username']

interface SheetState {
  values: Record<string, unknown>
  top: string[]
  tls: string[]
  advanced: string[]
  required: string[]
  groupOrder: string[]
}

function state(
  values: Record<string, unknown>,
  top: string[],
  tls: string[],
  advanced: string[],
  required: string[],
): SheetState {
  const groupOrder = tls.length === 0 ? SQLITE_GROUP_ORDER : GROUP_ORDER
  return { values, top: [...top, 'Timeout'], tls, advanced, required, groupOrder }
}

const STATES: [string, SheetState][] = [
  [
    'Run SQL on PostgreSQL (a fresh block)',
    state({}, [...NETWORK_HEAD, ...RUN_SOURCE], TLS_OFF_ROWS, ADV_FETCH, [...NETWORK_REQUIRED, 'sql']),
  ],
  [
    'Run SQL from a file',
    state({ script_type: 'file' }, [...NETWORK_HEAD, ...RUN_FILE], TLS_OFF_ROWS, ADV_FETCH, [
      ...NETWORK_REQUIRED,
      'sql_file',
    ]),
  ],
  [
    'Call procedure with TLS on',
    state({ operation: 'call_procedure', tls: true }, [...NETWORK_HEAD, ...CALL], TLS_ON_ROWS, ADV_FETCH, [
      ...NETWORK_REQUIRED,
      'procedure',
    ]),
  ],
  [
    'Load table, Add or replace, Commit each batch on',
    state(
      { operation: 'load_table', mode: 'add_or_replace', commit_each_batch: true },
      [...NETWORK_HEAD, ...LOAD_REPLACE_COMMIT],
      TLS_OFF_ROWS,
      ADV_LOAD,
      [...NETWORK_REQUIRED, 'table', 'target_table'],
    ),
  ],
  [
    'Load table, Add or replace, Commit each batch off',
    state(
      { operation: 'load_table', mode: 'add_or_replace', commit_each_batch: false },
      [...NETWORK_HEAD, ...LOAD_REPLACE],
      TLS_OFF_ROWS,
      ADV_LOAD,
      [...NETWORK_REQUIRED, 'table', 'target_table'],
    ),
  ],
  [
    'Load table, Add',
    state({ operation: 'load_table', mode: 'add' }, [...NETWORK_HEAD, ...LOAD_ADD], TLS_OFF_ROWS, ADV_LOAD, [
      ...NETWORK_REQUIRED,
      'table',
      'target_table',
    ]),
  ],
  [
    'Load table, Overwrite, Commit each batch on',
    state(
      { operation: 'load_table', mode: 'overwrite', commit_each_batch: true },
      [...NETWORK_HEAD, ...LOAD_ADD_COMMIT],
      TLS_OFF_ROWS,
      ADV_LOAD,
      [...NETWORK_REQUIRED, 'table', 'target_table'],
    ),
  ],
  [
    'Run SQL on SQLite',
    state({ database_type: 'sqlite' }, [...SQLITE_HEAD, ...RUN_SOURCE], [], ADV_FETCH, ['file', 'sql']),
  ],
  [
    'Run SQL on SQLite with TLS left on from a network type',
    state({ database_type: 'sqlite', tls: true }, [...SQLITE_HEAD, ...RUN_SOURCE], [], ADV_FETCH, [
      'file',
      'sql',
    ]),
  ],
  [
    'Load table on SQLite',
    state(
      { database_type: 'sqlite', operation: 'load_table' },
      [...SQLITE_HEAD, ...LOAD_ADD],
      [],
      ADV_LOAD,
      ['file', 'table', 'target_table'],
    ),
  ],
  [
    'Run SQL on SQL Server with TLS unset',
    state({ database_type: 'mssql' }, [...NETWORK_HEAD, ...RUN_SOURCE], TLS_ON_ROWS, ADV_FETCH, [
      ...NETWORK_REQUIRED,
      'sql',
    ]),
  ],
  [
    'Run SQL on SQL Server with TLS off',
    state({ database_type: 'mssql', tls: false }, [...NETWORK_HEAD, ...RUN_SOURCE], TLS_OFF_ROWS, ADV_FETCH, [
      ...NETWORK_REQUIRED,
      'sql',
    ]),
  ],
  [
    'Run SQL on PostgreSQL with TLS unset',
    state({ database_type: 'postgresql' }, [...NETWORK_HEAD, ...RUN_SOURCE], TLS_OFF_ROWS, ADV_FETCH, [
      ...NETWORK_REQUIRED,
      'sql',
    ]),
  ],
  [
    'Run SQL on MySQL',
    state({ database_type: 'mysql' }, [...NETWORK_HEAD, ...RUN_SOURCE], TLS_OFF_ROWS, ADV_FETCH, [
      ...NETWORK_REQUIRED,
      'sql',
    ]),
  ],
  [
    'Run SQL on Oracle',
    state({ database_type: 'oracle' }, [...NETWORK_HEAD, ...RUN_SOURCE], TLS_OFF_ROWS, ADV_FETCH, [
      ...NETWORK_REQUIRED,
      'sql',
    ]),
  ],
]

/** Every combination of the fields the twins are gated on. */
const TWIN_GRID: Record<string, unknown>[] = [undefined, ...DATABASE_TYPES].flatMap((databaseType) =>
  [undefined, ...OPERATIONS].flatMap((operation) =>
    [undefined, true, false].flatMap((commit) =>
      [undefined, true, false].map((tls) => {
        const values: Record<string, unknown> = {}
        if (databaseType !== undefined) values.database_type = databaseType
        if (operation !== undefined) values.operation = operation
        if (commit !== undefined) values.commit_each_batch = commit
        if (tls !== undefined) values.tls = tls
        return values
      }),
    ),
  ),
)

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('registration', () => {
  it('registers sql-client in PLUGIN_INPUTS', () => {
    expect(PLUGIN_INPUTS[ID]).toBeDefined()
  })

  it('registers sql-client in PLUGIN_OUTPUTS', () => {
    expect(PLUGIN_OUTPUTS[ID]).toBeDefined()
  })

  it('registers sql-client in PLUGIN_GROUPS', () => {
    expect(PLUGIN_GROUPS[ID]).toBeDefined()
  })

  it('registers sql-client in SECRET_MASK_FIELDS', () => {
    expect(SECRET_MASK_FIELDS[ID]).toBeDefined()
  })

  it('resolves sql-client via hasNodeParams', () => {
    expect(hasNodeParams(ID)).toBe(true)
  })

  it('serves the same arrays through the lookups', () => {
    expect(PLUGIN_INPUTS[ID]).toBeDefined()
    expect(getInputParams(ID)).toBe(PLUGIN_INPUTS[ID])
    expect(getOutputParams(ID)).toBe(PLUGIN_OUTPUTS[ID])
    expect(getGroupMeta(ID)).toBe(PLUGIN_GROUPS[ID])
    expect(getSecretMaskFields(ID)).toBe(SECRET_MASK_FIELDS[ID])
  })

  it('registers the inputs, outputs, groups and mask fields the sql-client module exports', async () => {
    // The global afterEach resets modules, so load the registry and the module from the same graph.
    const registry = (await import(/* @vite-ignore */ REGISTRY_MODULE)) as {
      PLUGIN_INPUTS: typeof PLUGIN_INPUTS
      PLUGIN_OUTPUTS: typeof PLUGIN_OUTPUTS
      PLUGIN_GROUPS: typeof PLUGIN_GROUPS
      SECRET_MASK_FIELDS: typeof SECRET_MASK_FIELDS
    }
    const sql = (await import(/* @vite-ignore */ SQL_MODULE)) as {
      inputs: InputParam[]
      outputs: OutputParam[]
      groups: Record<string, GroupMeta>
      secretMaskFields: SecretMaskField[]
    }
    expect(sql.inputs).toBeDefined()
    expect(registry.PLUGIN_INPUTS[ID]).toBe(sql.inputs)
    expect(registry.PLUGIN_OUTPUTS[ID]).toBe(sql.outputs)
    expect(registry.PLUGIN_GROUPS[ID]).toBe(sql.groups)
    expect(registry.SECRET_MASK_FIELDS[ID]).toBe(sql.secretMaskFields)
  })
})

describe('schema surface (SQL-1, SQL-8)', () => {
  it('declares the 38 descriptors in sheet order, the twins in place', () => {
    expect(inputs()).toHaveLength(DESCRIPTOR_COUNT)
    expect(inputs().map((p) => p.name)).toEqual(EXPECTED.map((e) => e.name))
  })

  it('labels every descriptor', () => {
    expect(inputs().map(label)).toEqual(EXPECTED.map((e) => e.label))
  })

  it('types every descriptor', () => {
    expect(inputs().map((p) => p.type)).toEqual(EXPECTED.map((e) => e.type))
  })

  it('defaults every descriptor', () => {
    expect(inputs().map((p) => p.defaultValue)).toEqual(EXPECTED.map((e) => e.defaultValue))
  })

  it('marks no descriptor required outright', () => {
    expect(inputs()).toHaveLength(DESCRIPTOR_COUNT)
    expect(inputs().map((p) => p.required)).toEqual(EXPECTED.map(() => false))
  })

  it('hides the expression toggle on the choices and Out arguments, and offers it on the SQL body (SQL-10)', () => {
    expect(inputs().map((p) => [p.name, p.noExpression])).toEqual(
      EXPECTED.map((e) => [e.name, e.noExpression]),
    )
  })

  it('leaves the top rows ungrouped and groups the TLS, Advanced and Failure Handling rows', () => {
    expect(inputs().map((p) => [p.name, p.group])).toEqual(EXPECTED.map((e) => [e.name, e.group]))
  })

  it('gives every descriptor a description that is more than its label', () => {
    expect(inputs()).toHaveLength(DESCRIPTOR_COUNT)
    for (const p of inputs()) {
      const description = (p.description ?? '').trim()
      expect(description, `description of ${p.name}`).not.toBe('')
      expect(description.toLowerCase(), `description of ${p.name}`).not.toBe(
        label(p).trim().toLowerCase(),
      )
    }
  })

  it('gives every output a description that is more than its label', () => {
    expect(outputs()).toHaveLength(OUTPUT_COUNT)
    for (const o of outputs()) {
      const description = (o.description ?? '').trim()
      expect(description, `description of ${o.name}`).not.toBe('')
      expect(description.toLowerCase(), `description of ${o.name}`).not.toBe(
        label(o).trim().toLowerCase(),
      )
    }
  })
})

describe('selects (SQL-1, SQL-6, SQL-7)', () => {
  it('renders a select only for the choices', () => {
    expect(inputs().filter((p) => p.enumValues !== undefined).map((p) => p.name)).toEqual([
      'operation',
      'operation',
      'database_type',
      'script_type',
      'mode',
      'on_error',
    ])
  })

  it('offers the five database types under Database type', () => {
    const databaseType = single('database_type')
    expect(databaseType.enumValues).toEqual(DATABASE_TYPES)
    expect(databaseType.enumLabels).toEqual({
      postgresql: 'PostgreSQL',
      mysql: 'MySQL / MariaDB',
      oracle: 'Oracle',
      mssql: 'SQL Server',
      sqlite: 'SQLite',
    })
  })

  it('offers Source and File under Script Type', () => {
    const scriptType = single('script_type')
    expect(scriptType.enumValues).toEqual(['source', 'file'])
    expect(scriptType.enumLabels).toEqual({ source: 'Source', file: 'File' })
  })

  it('offers Add, Add or replace and Overwrite under Mode', () => {
    const mode = single('mode')
    expect(mode.enumValues).toEqual(['add', 'add_or_replace', 'overwrite'])
    expect(mode.enumLabels).toEqual({
      add: 'Add',
      add_or_replace: 'Add or replace',
      overwrite: 'Overwrite',
    })
  })
})

describe('Operation twins (SQL-1, SQL-6)', () => {
  function networkTwin(): InputParam {
    const rows = twins('operation', 2)
    const network = rows.find((p) => p.enumValues?.includes('call_procedure'))
    expect(network, 'the Operation twin that offers Call procedure').toBeDefined()
    return network!
  }

  function sqliteTwin(): InputParam {
    const network = networkTwin()
    return twins('operation', 2).find((p) => p !== network)!
  }

  it('offers Run SQL, Call procedure and Load table on the network twin', () => {
    const network = networkTwin()
    expect(network.enumValues).toEqual(OPERATIONS)
    expect(network.enumLabels).toEqual({
      run_sql: 'Run SQL',
      call_procedure: 'Call procedure',
      load_table: 'Load table',
    })
  })

  it('offers Run SQL and Load table only on the SQLite twin (SQL-6)', () => {
    const sqlite = sqliteTwin()
    expect(sqlite.enumValues).toEqual(['run_sql', 'load_table'])
    expect(optionLabels(sqlite)).toEqual(['Run SQL', 'Load table'])
  })

  it.each(NETWORK_TYPES)('offers every operation on %s', (databaseType) => {
    expect(inputs()).toHaveLength(DESCRIPTOR_COUNT)
    expect(visibleNamed('operation', { database_type: databaseType }).map(optionLabels)).toEqual([
      ['Run SQL', 'Call procedure', 'Load table'],
    ])
  })

  it('offers no Call procedure on SQLite (SQL-6)', () => {
    expect(inputs()).toHaveLength(DESCRIPTOR_COUNT)
    expect(visibleNamed('operation', { database_type: 'sqlite' }).map(optionLabels)).toEqual([
      ['Run SQL', 'Load table'],
    ])
  })

  it('offers every operation on a fresh block', () => {
    expect(inputs()).toHaveLength(DESCRIPTOR_COUNT)
    expect(visibleNamed('operation', {}).map(optionLabels)).toEqual([
      ['Run SQL', 'Call procedure', 'Load table'],
    ])
  })
})

describe('Port twins (SQL-8)', () => {
  it('declares one Port per network type with its default port as the placeholder', () => {
    expect(twins('port', 4).map((p) => p.placeholder)).toEqual(['5432', '3306', '1521', '1433'])
  })

  it('bounds every Port twin from 1 to 65535', () => {
    for (const port of twins('port', 4)) {
      expect(port.minimum).toBe(1)
      expect(port.maximum).toBe(65535)
      expect(port.maximumField).toBeUndefined()
    }
  })

  it.each([
    ['postgresql', '5432'],
    ['mysql', '3306'],
    ['oracle', '1521'],
    ['mssql', '1433'],
  ])('shows the one Port row of %s, reading %s while blank', (databaseType, placeholder) => {
    expect(inputs()).toHaveLength(DESCRIPTOR_COUNT)
    expect(visibleNamed('port', { database_type: databaseType }).map((p) => p.placeholder)).toEqual([
      placeholder,
    ])
  })

  it('shows the PostgreSQL Port on a fresh block', () => {
    expect(inputs()).toHaveLength(DESCRIPTOR_COUNT)
    expect(visibleNamed('port', {}).map((p) => p.placeholder)).toEqual(['5432'])
  })

  it('shows no Port row on SQLite', () => {
    expect(inputs()).toHaveLength(DESCRIPTOR_COUNT)
    expect(visibleNamed('port', { database_type: 'sqlite' })).toEqual([])
  })
})

describe('Stop on error twins (SQL-3, SQL-7)', () => {
  it('turns both twins on by default', () => {
    expect(twins('stop_on_error', 2).map((p) => p.defaultValue)).toEqual([true, true])
  })

  it.each([
    [{}, [true, false]],
    [{ operation: 'run_sql' }, [true, false]],
    [{ operation: 'run_sql', commit_each_batch: true }, [true, false]],
    [{ operation: 'call_procedure' }, [false, false]],
    [{ operation: 'load_table' }, [false, false]],
    [{ operation: 'load_table', commit_each_batch: false }, [false, false]],
    [{ operation: 'load_table', commit_each_batch: true }, [false, true]],
  ])('shows the Run SQL twin and the Load table twin as %o -> %o', (values, expected) => {
    const rows = twins('stop_on_error', 2)
    expect(rows.map((p) => isParameterVisible(p as unknown as Parameter, values, table()))).toEqual(
      expected,
    )
  })
})

describe('TLS twins (SQL-8, REQ-5.1.4)', () => {
  it('turns TLS off by default on the first twin and on by default on the SQL Server twin', () => {
    expect(twins('tls', 2).map((p) => p.defaultValue)).toEqual([false, true])
  })

  it.each([
    ['postgresql', [true, false]],
    ['mysql', [true, false]],
    ['oracle', [true, false]],
    ['sqlite', [false, false]],
    ['mssql', [false, true]],
  ])('shows the TLS twins on %s as %o', (databaseType, expected) => {
    const rows = twins('tls', 2)
    expect(
      rows.map((p) =>
        isParameterVisible(p as unknown as Parameter, { database_type: databaseType }, table()),
      ),
    ).toEqual(expected)
  })

  it('shows the first TLS twin on a fresh block', () => {
    const rows = twins('tls', 2)
    expect(rows.map((p) => isParameterVisible(p as unknown as Parameter, {}, table()))).toEqual([
      true,
      false,
    ])
  })

  it('declares the four trust rows as the shared TLS rows, only their visibility added', async () => {
    const tlsTrustInputs = await loadTlsTrustInputs()
    const start = inputs().findIndex((p) => p.name === 'verify_ssl')
    expect(start).toBeGreaterThan(-1)
    expect(inputs().slice(start, start + 4).map(withoutGates)).toEqual(
      tlsTrustInputs(TLS_GROUP).map(withoutGates),
    )
  })

  it('shows no TLS row at all on SQLite, whatever TLS holds (REQ-5.1.4)', () => {
    expect(inputs()).toHaveLength(DESCRIPTOR_COUNT)
    for (const tls of [undefined, true, false]) {
      const values: Record<string, unknown> = { database_type: 'sqlite' }
      if (tls !== undefined) values.tls = tls
      expect(sheet(values).group(TLS_GROUP), `tls ${String(tls)}`).toEqual([])
    }
  })

  it.each(
    [undefined, ...DATABASE_TYPES].flatMap((databaseType) =>
      [undefined, true, false].map((tls) => [databaseType, tls] as const),
    ),
  )('shows the four trust rows on %s with TLS %s only while TLS is on and the type is a network type', (databaseType, tls) => {
    const values: Record<string, unknown> = {}
    if (databaseType !== undefined) values.database_type = databaseType
    if (tls !== undefined) values.tls = tls
    const network = databaseType !== 'sqlite'
    const tlsOn = tls ?? databaseType === 'mssql'
    const shown = inputs()
      .filter((p) => TRUST_NAMES.includes(p.name))
      .map((p) => isParameterVisible(p as unknown as Parameter, values, table()))

    expect(shown).toEqual(TRUST_NAMES.map(() => network && tlsOn))
  })
})

describe('twins share one wire name (SQL-1, SQL-8)', () => {
  it.each([
    ['operation', 2, 'Operation', 'string'],
    ['port', 4, 'Port', 'integer'],
    ['stop_on_error', 2, 'Stop on error', 'boolean'],
    ['tls', 2, 'TLS', 'boolean'],
  ])('declares every %s twin with one label, type and required flag', (name, count, lbl, type) => {
    expect(twins(name, count).map((p) => [label(p), p.type, p.required])).toEqual(
      Array.from({ length: count }, () => [lbl, type, false]),
    )
  })

  it('shows exactly one operation row in every state', () => {
    expect(inputsNamed('operation').length).toBeGreaterThan(1)
    for (const values of TWIN_GRID) {
      expect(visibleNamed('operation', values), JSON.stringify(values)).toHaveLength(1)
    }
  })

  it('shows exactly one TLS row in every state of a network type, and none on SQLite', () => {
    expect(inputsNamed('tls').length).toBeGreaterThan(1)
    for (const values of TWIN_GRID) {
      const expected = values.database_type === 'sqlite' ? 0 : 1
      expect(visibleNamed('tls', values), JSON.stringify(values)).toHaveLength(expected)
    }
  })

  it.each(['port', 'stop_on_error'])('never shows two %s rows at once', (name) => {
    expect(inputsNamed(name).length).toBeGreaterThan(1)
    for (const values of TWIN_GRID) {
      expect(visibleNamed(name, values).length, JSON.stringify(values)).toBeLessThanOrEqual(1)
    }
  })
})

describe('numeric bounds (SQL-4, SQL-8)', () => {
  it('builds the Timeout row with the shared builder at 300 seconds', () => {
    const timeout = single('timeout')
    expect(timeout).toEqual(timeoutInput(300, timeout.description ?? ''))
    expect(timeout.minimum).toBe(1)
    expect(timeout.maximum).toBeUndefined()
  })

  it.each([
    ['connect_timeout', 1],
    ['max_rows', 0],
    ['batch_size', 1],
  ])('declares a lowest value on %s of %d and no highest value', (name, minimum) => {
    const entry = single(name)
    expect(entry.minimum).toBe(minimum)
    expect(entry.maximum).toBeUndefined()
    expect(entry.maximumField).toBeUndefined()
  })

  it('leaves every other row unbounded', () => {
    const bounded = new Set(['port', 'timeout', 'connect_timeout', 'max_rows', 'batch_size'])
    const others = inputs().filter((p) => !bounded.has(p.name))
    expect(others).toHaveLength(30)
    for (const p of others) {
      expect(p.minimum, `minimum of ${p.name}`).toBeUndefined()
      expect(p.maximum, `maximum of ${p.name}`).toBeUndefined()
      expect(p.maximumField, `maximumField of ${p.name}`).toBeUndefined()
    }
  })
})

describe('row flags (SQL-2, SQL-6, SQL-7, SQL-8, REQ-4.7.11)', () => {
  it('marks only Password and Client Key secret', () => {
    expect(inputs()).toHaveLength(DESCRIPTOR_COUNT)
    expect(inputs().filter((p) => p.secret === true).map((p) => p.name)).toEqual([
      'password',
      'client_key',
    ])
  })

  it('opens the file picker on File, SQL File and Table only, over Test Data and Artifacts', () => {
    expect(inputs()).toHaveLength(DESCRIPTOR_COUNT)
    expect(
      inputs()
        .filter((p) => p.fileReference !== undefined)
        .map((p) => [p.name, p.fileReference, p.fileReferenceArtifactsOnly]),
    ).toEqual([
      ['file', 'file', undefined],
      ['sql_file', 'file', undefined],
      ['table', 'file', undefined],
    ])
  })

  it('types the Load table Table row as a table, so it takes a table variable or a file', () => {
    const tableRow = single('table')
    expect(tableRow.type).toBe('table')
    expect(tableRow.fileReference).toBe('file')
  })

  it('shows a placeholder only on the Port twins, File and SQL File', () => {
    expect(inputs()).toHaveLength(DESCRIPTOR_COUNT)
    expect(
      inputs()
        .filter((p) => p.placeholder !== undefined)
        .map((p) => [p.name, p.placeholder]),
    ).toEqual([
      ['port', '5432'],
      ['port', '3306'],
      ['port', '1521'],
      ['port', '1433'],
      ['file', FILE_PLACEHOLDER],
      ['sql_file', FILE_PLACEHOLDER],
    ])
  })

  it('shows the Python Script File placeholder on File and SQL File', () => {
    const scriptFile = (getInputParams(PYTHON) ?? []).find((p) => p.name === 'script_file')
    expect(single('file').placeholder).toBe(scriptFile?.placeholder)
    expect(single('sql_file').placeholder).toBe(scriptFile?.placeholder)
  })

  it('locks the SQL body editor to SQL', () => {
    expect(single('sql').allowedFormats).toEqual(['sql'])
  })

  it('offers the {} expression toggle on the SQL body (SQL-10)', () => {
    expect(single('sql').noExpression).toBeUndefined()
  })

  it('says the SQL body takes an expression that gives the SQL text (SQL-10)', () => {
    expect(single('sql').description).toBe(
      'One statement or a whole script. Statements end with ; (GO on SQL Server, / after a PL/SQL block on Oracle). Write :name where a value goes and add it to Parameters. With {}, an expression gives the SQL text; :name parameters still bind.',
    )
  })

  it('edits the Password as plain text', () => {
    expect(single('password').allowedFormats).toEqual(['plain'])
  })

  it('edits Out arguments as an ordered list of argument names with bare positions', () => {
    expect(inputs()).toHaveLength(DESCRIPTOR_COUNT)
    expect(
      inputs()
        .filter((p) => p.orderedList !== undefined)
        .map((p) => [p.name, p.orderedList]),
    ).toEqual([['out_arguments', { itemNoun: 'argument', positionPrefix: '' }]])
  })

  it('keeps the connection, body and operation drafts across a toggle, and no twin', () => {
    expect(inputs()).toHaveLength(DESCRIPTOR_COUNT)
    expect(inputs().filter((p) => p.retainOnHide === true).map((p) => p.name)).toEqual([
      'host',
      'database',
      'username',
      'password',
      'file',
      'sql',
      'sql_file',
      'parameters',
      'procedure',
      'arguments',
      'out_arguments',
      'table',
      'target_table',
      'key_columns',
    ])
  })

  it('uses the shared On error row', () => {
    expect(single('on_error')).toEqual(failureHandlingOnErrorInput())
  })
})

describe('groups (SQL-8)', () => {
  it('declares TLS / Certificates, Advanced and Failure Handling, in that order', () => {
    expect(Object.keys(getGroupMeta(ID) ?? {})).toEqual(GROUP_ORDER)
  })

  it('keeps TLS / Certificates and Advanced collapsed, with no footer, beside the shared Failure Handling group', () => {
    expect(getGroupMeta(ID)).toEqual({
      [TLS_GROUP]: { name: TLS_GROUP },
      [ADVANCED]: { name: ADVANCED },
      [FAILURE_HANDLING_GROUP]: failureHandlingGroup(),
    })
  })
})

describe('sheet per state (SQL-1, SQL-6, SQL-7, SQL-8)', () => {
  it.each(STATES)('shows the top rows of %s in order', (_title, s) => {
    expect(sheet(s.values).top).toEqual(s.top)
  })

  it.each(STATES)('fills the TLS / Certificates group of %s', (_title, s) => {
    expect(visibleRows(s.values).length).toBeGreaterThan(0)
    expect(sheet(s.values).group(TLS_GROUP)).toEqual(s.tls)
  })

  it.each(STATES)('fills the Advanced group of %s', (_title, s) => {
    expect(visibleRows(s.values).length).toBeGreaterThan(0)
    expect(sheet(s.values).group(ADVANCED)).toEqual(s.advanced)
  })

  it.each(STATES)('keeps On error in Failure Handling in %s', (_title, s) => {
    expect(sheet(s.values).group(FAILURE_HANDLING_GROUP)).toEqual(['On error'])
  })

  it.each(STATES)('renders the groups of %s in order', (_title, s) => {
    expect(sheet(s.values).groupOrder).toEqual(s.groupOrder)
  })

  it.each(STATES)('requires only visible rows in %s', (_title, s) => {
    const visible = visibleRows(s.values)
    expect(visible.length).toBeGreaterThan(0)
    for (const p of inputs().filter((entry) => requiredFor(entry, s.values))) {
      expect(visible, `required row ${p.name}`).toContain(p)
    }
  })

  it.each(STATES)('requires exactly the rows of %s', (_title, s) => {
    expect(requiredNames(s.values)).toEqual(s.required)
  })
})

describe('required rules (SQL-8)', () => {
  it.each(['host', 'database', 'username'])('requires %s on every network type and never on SQLite', (name) => {
    const entry = single(name)
    expect(NETWORK_TYPES.map((t) => requiredFor(entry, { database_type: t }))).toEqual(
      NETWORK_TYPES.map(() => true),
    )
    expect(requiredFor(entry, { database_type: 'sqlite' })).toBe(false)
  })

  it('requires File on SQLite only', () => {
    const file = single('file')
    expect(requiredFor(file, { database_type: 'sqlite' })).toBe(true)
    expect(NETWORK_TYPES.map((t) => requiredFor(file, { database_type: t }))).toEqual(
      NETWORK_TYPES.map(() => false),
    )
  })

  it('requires SQL while Run SQL takes its source here, and SQL File while it reads a file', () => {
    const sql = single('sql')
    const sqlFile = single('sql_file')
    expect([requiredFor(sql, {}), requiredFor(sqlFile, {})]).toEqual([true, false])
    expect([
      requiredFor(sql, { script_type: 'file' }),
      requiredFor(sqlFile, { script_type: 'file' }),
    ]).toEqual([false, true])
    expect([
      requiredFor(sql, { operation: 'call_procedure' }),
      requiredFor(sqlFile, { operation: 'load_table', script_type: 'file' }),
    ]).toEqual([false, false])
  })

  it('requires Procedure on Call procedure only', () => {
    const procedure = single('procedure')
    expect(OPERATIONS.map((operation) => requiredFor(procedure, { operation }))).toEqual([
      false,
      true,
      false,
    ])
  })

  it.each(['table', 'target_table'])('requires %s on Load table only', (name) => {
    const entry = single(name)
    expect(OPERATIONS.map((operation) => requiredFor(entry, { operation }))).toEqual([
      false,
      false,
      true,
    ])
  })

  it('never requires Port, Password, Parameters, Arguments or Key columns', () => {
    expect(inputs()).toHaveLength(DESCRIPTOR_COUNT)
    const optional = ['port', 'password', 'parameters', 'arguments', 'key_columns']
    for (const values of TWIN_GRID) {
      const required = requiredNames(values)
      for (const name of optional) {
        expect(required, `${name} in ${JSON.stringify(values)}`).not.toContain(name)
      }
    }
  })
})

describe('an unset twin reads the default of its visible descriptor (SQL-8)', () => {
  it('reads an unset TLS as on for SQL Server', () => {
    expect(twins('tls', 2)).toHaveLength(2)
    expect(matchesCondition(TLS_ON, { database_type: 'mssql' }, table())).toBe(true)
  })

  it.each([['postgresql'], ['mysql'], ['oracle'], ['sqlite']])(
    'reads an unset TLS as off for %s',
    (databaseType) => {
      expect(twins('tls', 2)).toHaveLength(2)
      expect(matchesCondition(TLS_ON, { database_type: databaseType }, table())).toBe(false)
    },
  )

  it('reads an unset TLS as off on a fresh block', () => {
    expect(twins('tls', 2)).toHaveLength(2)
    expect(matchesCondition(TLS_ON, {}, table())).toBe(false)
  })

  it('reads a set TLS as it is, whatever the database type', () => {
    expect(twins('tls', 2)).toHaveLength(2)
    expect(matchesCondition(TLS_ON, { database_type: 'mssql', tls: false }, table())).toBe(false)
    expect(matchesCondition(TLS_ON, { database_type: 'postgresql', tls: true }, table())).toBe(true)
  })

  it('falls back to the first TLS descriptor when no TLS descriptor is visible', () => {
    expect(twins('tls', 2)).toHaveLength(2)
    expect(matchesCondition(TLS_ON, { database_type: 'db2' }, table())).toBe(false)
  })

  it('shows the four trust rows on SQL Server while TLS is unset', () => {
    const trust = ['verify_ssl', 'ca_cert', 'client_cert', 'client_key']
    expect(visibleRows({ database_type: 'mssql' }).filter((p) => trust.includes(p.name)).map((p) => p.name)).toEqual(
      trust,
    )
  })

  it('hides the four trust rows on PostgreSQL while TLS is unset', () => {
    const trust = ['verify_ssl', 'ca_cert', 'client_cert', 'client_key']
    expect(inputs()).toHaveLength(DESCRIPTOR_COUNT)
    expect(visibleRows({ database_type: 'postgresql' }).filter((p) => trust.includes(p.name))).toEqual([])
  })

  it('hides the four trust rows on SQLite even with TLS on', () => {
    expect(inputs()).toHaveLength(DESCRIPTOR_COUNT)
    expect(
      visibleRows({ database_type: 'sqlite', tls: true }).filter((p) => TRUST_NAMES.includes(p.name)),
    ).toEqual([])
  })
})

describe('outputs (SQL-9)', () => {
  it('declares Success, Rows, Row count, Rows changed, Out values, Error and Reason with their types', () => {
    expect(outputs().map((o) => [o.name, o.type])).toEqual([
      ['success', 'boolean'],
      ['rows', 'table'],
      ['row_count', 'integer'],
      ['rows_changed', 'integer'],
      ['out_values', 'table'],
      ['error', 'string'],
      ['reason', 'string'],
    ])
  })

  it('labels every output', () => {
    expect(outputs().map(label)).toEqual([
      'Success',
      'Rows',
      'Row count',
      'Rows changed',
      'Out values',
      'Error',
      'Reason',
    ])
  })

  it('uses the shared Error row of the output core', () => {
    const shared = outputCore({ successDescription: 'x', reasonDescription: 'y' })[1]
    expect(outputs().find((o) => o.name === 'error')).toEqual(shared)
  })

  it('names every failure reason in the Reason description (SQL-5)', () => {
    const reason = outputs().find((o) => o.name === 'reason')
    expect(reason).toBeDefined()
    for (const word of ['Unreachable', 'AuthFailed', 'DatabaseError', 'Timeout', 'Validation', 'Unsupported']) {
      expect(reason!.description, word).toContain(word)
    }
  })

  it.each([
    [{}, ['success', 'rows', 'row_count', 'rows_changed']],
    [{ operation: 'run_sql', on_error: 'fail' }, ['success', 'rows', 'row_count', 'rows_changed']],
    [{ operation: 'call_procedure', on_error: 'fail' }, ['success', 'rows', 'row_count', 'out_values']],
    [{ operation: 'load_table', on_error: 'fail' }, ['success', 'rows_changed']],
    [
      { operation: 'run_sql', on_error: 'record' },
      ['success', 'rows', 'row_count', 'rows_changed', 'error', 'reason'],
    ],
    [
      { operation: 'call_procedure', on_error: 'record' },
      ['success', 'rows', 'row_count', 'out_values', 'error', 'reason'],
    ],
    [{ operation: 'load_table', on_error: 'record' }, ['success', 'rows_changed', 'error', 'reason']],
    [{ database_type: 'sqlite' }, ['success', 'rows', 'row_count', 'rows_changed']],
    [{ database_type: 'sqlite', operation: 'load_table' }, ['success', 'rows_changed']],
  ])('offers the outputs for %o', (values, expected) => {
    expect(visibleOutputs(values)).toEqual(expected)
  })

  it('marks no output secret and gives none a type rule', () => {
    expect(outputs()).toHaveLength(OUTPUT_COUNT)
    expect(outputs().filter((o) => o.secret === true).map((o) => o.name)).toEqual([])
    expect(outputs().filter((o) => o.typeWhen !== undefined).map((o) => o.name)).toEqual([])
  })
})

describe('palette and icon (SQL-15)', () => {
  it('keeps the SQL palette row in the Database category', () => {
    const def = getPluginById(ID)
    expect(def).toBeDefined()
    expect(def!.name).toBe('SQL')
    expect(def!.category).toBe('database')
    expect(def!.iconName).toBe('Database')
    expect(def!.colorClass).toBe('text-purple-500')
  })

  it('runs on a remote host inside a Remote Execution body (SQL-15)', () => {
    expect(getPluginById(ID)?.remotable).toBe(true)
  })

  it('keeps the Database glyph and the purple color on the canvas', () => {
    expect(getIcon(ID)).toBe(Database)
    expect(getIconName(ID)).toBe('database')
    expect(getColorClass(ID)).toBe('text-purple-500')
  })
})

describe('plain-text rows', () => {
  it('locks Host to plain text, so its editor has no Format picker', () => {
    expect(inputsNamed('host').map((row) => row.allowedFormats)).toEqual([['plain']])
  })
})
