/**
 * OpenSearch descriptor tests (REQ-3.4.1.15, REQ-3.3.2.2, REQ-3.3.2.3, REQ-3.3.2.5, REQ-3.3.2.6, REQ-3.3.3.1,
 * REQ-3.3.3.2, REQ-3.3.3.6, REQ-3.1.3.16, REQ-5.1.4).
 *
 * Design decisions: OS-1 to OS-8, OS-11, OS-12, OS-13, OS-14
 */

import { describe, it, expect } from 'vitest'
import { SearchCode } from 'lucide-react'
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
import { group, output, param } from '@/features/workbench/lib/node-parameters/types'
import {
  FAILURE_HANDLING_GROUP,
  failureHandlingGroup,
  failureHandlingOnErrorInput,
  outputCore,
  timeoutInput,
} from '@/features/workbench/lib/node-parameters/plugins/_shared-params'
import { tlsTrustInputs } from '@/features/workbench/lib/node-parameters/plugins/_tls-shared'
import {
  apiKeySchemeNote,
  bearerSchemeNote,
  fromNote,
  tlsOnHttpNote,
} from '@/features/workbench/lib/opensearch/row-notes'
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

const ID = 'opensearch'
const OPENSEARCH_MODULE = '@/features/workbench/lib/node-parameters/plugins/opensearch'
const REGISTRY_MODULE = '@/features/workbench/lib/node-parameters'
const SORT = 'Sort'
const AUTH = 'Authentication'
const TLS_GROUP = 'TLS / Certificates'
const ADVANCED = 'Advanced'
const DESCRIPTOR_COUNT = 28
const OUTPUT_COUNT = 5

const SEARCH = { field: 'mode', values: ['search'] }
const AGGREGATE = { field: 'mode', values: ['aggregate'] }
const DQL = { field: 'query_language', values: ['dql'] }
const DSL = { field: 'query_language', values: ['query_dsl'] }

const AUTH_DESCRIPTION =
  'How WAVE identifies itself to the cluster: a username and password, an API key, a bearer token, or none. A client certificate under TLS / Certificates can go with any of them.'

const DESCRIPTIONS: Record<string, string> = {
  url: "The cluster's REST address with scheme and port: https://opensearch.internal:9200",
  index:
    "Where to look: one index, a wildcard such as logs-*, a comma list, exclusions with a leading minus, an alias, a data stream, or a date-math name such as <logs-{now/d}> for today's daily index. Sent as written; OpenSearch resolves it",
  from: 'Start of the window: Absolute, Relative or Now, or a variable or expression with {}',
  to: 'End of the window: Absolute, Relative or Now, or a variable or expression with {}',
  query_language: 'DQL or Query DSL',
  query:
    'A DQL line or the query part of a Query DSL request; with {}, an expression that gives the query; empty means no filter',
  mode: 'Search returns the matching documents; Aggregate returns numbers worked out from them',
  fields:
    'The fields that come back, one column each, in this order; nested fields with dots, such as user.name. Empty returns the whole document as one column',
  max_results: 'Lines Results keeps; 0 keeps every line',
  group_by_time: 'No, or Every 10 seconds, 30 seconds, 1 minute, 5 minutes, 15 minutes or 1 hour',
  group_by_field: 'A field whose values each get their own rows',
  top_values: "How many of the grouped field's most common values get rows",
  stats:
    'The numbers to work out, one column each: Count, Sum, Average, Min, Max, Percentile, Unique count, Increase or Custom (JSON)',
  timeout: 'Seconds for the whole block, paging included; when it runs out the search is ended on the cluster',
  sort_by: 'The field to sort on; any sortable field',
  order: 'Newest first or Oldest first',
  username: 'Login name',
  password: 'A secret, masked everywhere',
  api_key: 'An API key the cluster issued; a secret',
  bearer_token: 'A token such as a JSON Web Token; a secret',
  time_field: 'The date field the window reads',
  connect_timeout: 'Seconds to wait for the cluster to accept the connection and finish the TLS handshake',
}

const GROUP_BY_TIME_LABELS = {
  none: 'No',
  '10s': 'Every 10 seconds',
  '30s': 'Every 30 seconds',
  '1m': 'Every 1 minute',
  '5m': 'Every 5 minutes',
  '15m': 'Every 15 minutes',
  '1h': 'Every 1 hour',
}

/** The 28 descriptors in sheet order with their exact keys; the two Query rows are twins. */
const EXPECTED: InputParam[] = [
  param('url', 'Cluster URL', 'string', true, DESCRIPTIONS.url, {
    placeholder: 'https://opensearch.internal:9200',
    allowedFormats: ['plain'],
  }),
  param('index', 'Index pattern', 'string', true, DESCRIPTIONS.index, {
    placeholder: 'logs-*',
    fieldSuggest: { source: 'indexes' },
  }),
  param('from', 'From', 'string', false, DESCRIPTIONS.from, {
    defaultValue: 'now-15m',
    timeValue: true,
    rowNote: fromNote,
  }),
  param('to', 'To', 'string', false, DESCRIPTIONS.to, {
    defaultValue: 'now',
    timeValue: true,
  }),
  param('query_language', 'Query language', 'string', false, DESCRIPTIONS.query_language, {
    enumValues: ['dql', 'query_dsl'],
    enumLabels: { dql: 'DQL', query_dsl: 'Query DSL' },
    defaultValue: 'dql',
    noExpression: true,
  }),
  param('query', 'Query', 'string', false, DESCRIPTIONS.query, {
    defaultValue: '',
    allowedFormats: ['dql'],
    showWhen: DQL,
    templateByDefault: true,
  }),
  param('query', 'Query', 'string', false, DESCRIPTIONS.query, {
    defaultValue: '',
    allowedFormats: ['query-dsl'],
    showWhen: DSL,
    templateByDefault: true,
  }),
  param('mode', 'Mode', 'string', false, DESCRIPTIONS.mode, {
    enumValues: ['search', 'aggregate'],
    enumLabels: { search: 'Search', aggregate: 'Aggregate' },
    defaultValue: 'search',
    noExpression: true,
  }),
  param('fields', 'Fields', 'array', false, DESCRIPTIONS.fields, {
    defaultValue: [{ value: '@timestamp' }],
    orderedList: { itemNoun: 'field', positionPrefix: '', entry: 'field' },
    showWhen: SEARCH,
    retainOnHide: true,
  }),
  param('max_results', 'Max results', 'integer', false, DESCRIPTIONS.max_results, {
    defaultValue: 10000,
    minimum: 0,
    showWhen: SEARCH,
    retainOnHide: true,
  }),
  param('group_by_time', 'Group by time', 'string', false, DESCRIPTIONS.group_by_time, {
    enumValues: ['none', '10s', '30s', '1m', '5m', '15m', '1h'],
    enumLabels: GROUP_BY_TIME_LABELS,
    defaultValue: '1m',
    showWhen: AGGREGATE,
    retainOnHide: true,
  }),
  param('group_by_field', 'Group by field', 'string', false, DESCRIPTIONS.group_by_field, {
    defaultValue: '',
    placeholder: 'No field',
    fieldSuggest: { source: 'fields', types: 'aggregatable' },
    showWhen: AGGREGATE,
    retainOnHide: true,
  }),
  param('top_values', 'Top values', 'integer', false, DESCRIPTIONS.top_values, {
    defaultValue: 10,
    minimum: 1,
    showWhen: AGGREGATE,
    retainOnHide: true,
  }),
  param('stats', 'Stats', 'array', false, DESCRIPTIONS.stats, {
    defaultValue: [{ value: { stat: 'count' } }],
    orderedList: { itemNoun: 'stat', positionPrefix: '', entry: 'stat' },
    showWhen: AGGREGATE,
    retainOnHide: true,
  }),
  timeoutInput(300, DESCRIPTIONS.timeout),
  param('sort_by', 'Sort by', 'string', false, DESCRIPTIONS.sort_by, {
    group: SORT,
    defaultValue: '',
    placeholder: 'Time field',
    fieldSuggest: { source: 'fields', types: 'aggregatable' },
    showWhen: SEARCH,
    retainOnHide: true,
  }),
  param('order', 'Order', 'string', false, DESCRIPTIONS.order, {
    group: SORT,
    enumValues: ['desc', 'asc'],
    enumLabels: { desc: 'Newest first', asc: 'Oldest first' },
    defaultValue: 'desc',
    showWhen: SEARCH,
    retainOnHide: true,
  }),
  param('username', 'Username', 'string', false, DESCRIPTIONS.username, { group: AUTH }),
  param('password', 'Password', 'string', false, DESCRIPTIONS.password, {
    group: AUTH,
    secret: true,
    allowedFormats: ['plain'],
  }),
  param('api_key', 'API Key', 'string', false, DESCRIPTIONS.api_key, {
    group: AUTH,
    secret: true,
    allowedFormats: ['plain'],
    rowNote: apiKeySchemeNote,
  }),
  param('bearer_token', 'Bearer Token', 'string', false, DESCRIPTIONS.bearer_token, {
    group: AUTH,
    secret: true,
    allowedFormats: ['plain'],
    rowNote: bearerSchemeNote,
  }),
  ...tlsTrustInputs(TLS_GROUP).map((row) => ({ ...row, rowNote: tlsOnHttpNote })),
  param('time_field', 'Time field', 'string', false, DESCRIPTIONS.time_field, {
    group: ADVANCED,
    defaultValue: '@timestamp',
    fieldSuggest: { source: 'fields', types: 'date' },
  }),
  param('connect_timeout', 'Connect timeout', 'integer', false, DESCRIPTIONS.connect_timeout, {
    group: ADVANCED,
    defaultValue: 30,
    minimum: 1,
  }),
  failureHandlingOnErrorInput(),
]

const EXPECTED_NAMES = [
  'url',
  'index',
  'from',
  'to',
  'query_language',
  'query',
  'query',
  'mode',
  'fields',
  'max_results',
  'group_by_time',
  'group_by_field',
  'top_values',
  'stats',
  'timeout',
  'sort_by',
  'order',
  'username',
  'password',
  'api_key',
  'bearer_token',
  'verify_ssl',
  'ca_cert',
  'client_cert',
  'client_key',
  'time_field',
  'connect_timeout',
  'on_error',
]

const EXPECTED_LABELS = [
  'Cluster URL',
  'Index pattern',
  'From',
  'To',
  'Query language',
  'Query',
  'Query',
  'Mode',
  'Fields',
  'Max results',
  'Group by time',
  'Group by field',
  'Top values',
  'Stats',
  'Timeout',
  'Sort by',
  'Order',
  'Username',
  'Password',
  'API Key',
  'Bearer Token',
  'Verify Server Certificate',
  'CA Certificate',
  'Client Certificate',
  'Client Key',
  'Time field',
  'Connect timeout',
  'On error',
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

/** The two Query twins in sheet order; fails the test on the wrong count. */
function queryTwins(): InputParam[] {
  const rows = inputsNamed('query')
  expect(rows, 'descriptors named query').toHaveLength(2)
  return rows
}

function label(entry: { name: string; label?: string }): string {
  return entry.label ?? entry.name
}

function optionLabels(entry: InputParam): string[] {
  return (entry.enumValues ?? []).map((v) => entry.enumLabels?.[v] ?? String(v))
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

/** [name, key value] for every descriptor that carries the key, in sheet order. */
function carrying<K extends keyof InputParam>(key: K): [string, InputParam[K]][] {
  return inputs()
    .filter((p) => p[key] !== undefined)
    .map((p) => [p.name, p[key]])
}

// ---------------------------------------------------------------------------
// The sheet states
// ---------------------------------------------------------------------------

const HEAD = ['Cluster URL', 'Index pattern', 'From', 'To', 'Query language', 'Query', 'Mode']
const SEARCH_ROWS = ['Fields', 'Max results']
const AGGREGATE_ROWS = ['Group by time', 'Group by field', 'Top values', 'Stats']
const SORT_ROWS = ['Sort by', 'Order']
const AUTH_ROWS = ['Username', 'Password', 'API Key', 'Bearer Token']
const TLS_ROWS = ['Verify Server Certificate', 'CA Certificate', 'Client Certificate', 'Client Key']
const ADVANCED_ROWS = ['Time field', 'Connect timeout']
const SEARCH_GROUPS = [SORT, AUTH, TLS_GROUP, ADVANCED, FAILURE_HANDLING_GROUP]
const AGGREGATE_GROUPS = [AUTH, TLS_GROUP, ADVANCED, FAILURE_HANDLING_GROUP]

interface SheetState {
  values: Record<string, unknown>
  top: string[]
  sort: string[]
  groupOrder: string[]
  queryFormat: string
}

function searchState(values: Record<string, unknown>, queryFormat: string): SheetState {
  return {
    values,
    top: [...HEAD, ...SEARCH_ROWS, 'Timeout'],
    sort: SORT_ROWS,
    groupOrder: SEARCH_GROUPS,
    queryFormat,
  }
}

function aggregateState(values: Record<string, unknown>, queryFormat: string): SheetState {
  return {
    values,
    top: [...HEAD, ...AGGREGATE_ROWS, 'Timeout'],
    sort: [],
    groupOrder: AGGREGATE_GROUPS,
    queryFormat,
  }
}

const STATES: [string, SheetState][] = [
  ['a fresh block (Search, DQL)', searchState({}, 'dql')],
  ['Search with DQL', searchState({ mode: 'search', query_language: 'dql' }, 'dql')],
  ['Search with Query DSL', searchState({ mode: 'search', query_language: 'query_dsl' }, 'query-dsl')],
  ['Aggregate with DQL unset', aggregateState({ mode: 'aggregate' }, 'dql')],
  ['Aggregate with Query DSL', aggregateState({ mode: 'aggregate', query_language: 'query_dsl' }, 'query-dsl')],
  [
    'Aggregate with every Search row still drafted',
    aggregateState(
      { mode: 'aggregate', fields: [{ value: 'message' }], max_results: 5, sort_by: 'latency_ms', order: 'asc' },
      'dql',
    ),
  ],
  [
    'Search with every Aggregate row still drafted',
    searchState(
      { mode: 'search', group_by_time: '5m', group_by_field: 'host.name', top_values: 3, stats: [] },
      'dql',
    ),
  ],
]

/** Every combination of the fields the Query twins and the mode rows are gated on. */
const GATE_GRID: Record<string, unknown>[] = [undefined, 'dql', 'query_dsl'].flatMap((language) =>
  [undefined, 'search', 'aggregate'].map((mode) => {
    const values: Record<string, unknown> = {}
    if (language !== undefined) values.query_language = language
    if (mode !== undefined) values.mode = mode
    return values
  }),
)

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('registration', () => {
  it('registers opensearch in PLUGIN_INPUTS', () => {
    expect(PLUGIN_INPUTS[ID]).toBeDefined()
  })

  it('registers opensearch in PLUGIN_OUTPUTS', () => {
    expect(PLUGIN_OUTPUTS[ID]).toBeDefined()
  })

  it('registers opensearch in PLUGIN_GROUPS', () => {
    expect(PLUGIN_GROUPS[ID]).toBeDefined()
  })

  it('registers opensearch in SECRET_MASK_FIELDS', () => {
    expect(SECRET_MASK_FIELDS[ID]).toBeDefined()
  })

  it('resolves opensearch via hasNodeParams', () => {
    expect(hasNodeParams(ID)).toBe(true)
  })

  it('serves the same arrays through the lookups', () => {
    expect(PLUGIN_INPUTS[ID]).toBeDefined()
    expect(getInputParams(ID)).toBe(PLUGIN_INPUTS[ID])
    expect(getOutputParams(ID)).toBe(PLUGIN_OUTPUTS[ID])
    expect(getGroupMeta(ID)).toBe(PLUGIN_GROUPS[ID])
    expect(getSecretMaskFields(ID)).toBe(SECRET_MASK_FIELDS[ID])
  })

  it('serves the rows and outputs', () => {
    expect(inputs()).toHaveLength(DESCRIPTOR_COUNT)
    expect(getInputParams(ID)).toBe(PLUGIN_INPUTS[ID])
    expect(getOutputParams(ID)).toBe(PLUGIN_OUTPUTS[ID])
  })

  it('registers the inputs, outputs, groups and mask fields the opensearch module exports', async () => {
    // The global afterEach resets modules, so load the registry and the module from the same graph.
    const registry = (await import(/* @vite-ignore */ REGISTRY_MODULE)) as {
      PLUGIN_INPUTS: typeof PLUGIN_INPUTS
      PLUGIN_OUTPUTS: typeof PLUGIN_OUTPUTS
      PLUGIN_GROUPS: typeof PLUGIN_GROUPS
      SECRET_MASK_FIELDS: typeof SECRET_MASK_FIELDS
    }
    const openSearch = (await import(/* @vite-ignore */ OPENSEARCH_MODULE)) as {
      inputs: InputParam[]
      outputs: OutputParam[]
      groups: Record<string, GroupMeta>
      secretMaskFields: SecretMaskField[]
    }
    expect(openSearch.inputs).toBeDefined()
    expect(registry.PLUGIN_INPUTS[ID]).toBe(openSearch.inputs)
    expect(registry.PLUGIN_OUTPUTS[ID]).toBe(openSearch.outputs)
    expect(registry.PLUGIN_GROUPS[ID]).toBe(openSearch.groups)
    expect(registry.SECRET_MASK_FIELDS[ID]).toBe(openSearch.secretMaskFields)
  })
})

describe('schema surface (REQ-3.4.1.15, OS-1, OS-2, OS-3)', () => {
  it('declares the 28 descriptors in sheet order, the Query twins in place', () => {
    expect(inputs()).toHaveLength(DESCRIPTOR_COUNT)
    expect(inputs().map((p) => p.name)).toEqual(EXPECTED_NAMES)
  })

  it('labels every descriptor', () => {
    expect(inputs().map(label)).toEqual(EXPECTED_LABELS)
  })

  it('types every descriptor', () => {
    expect(inputs().map((p) => [p.name, p.type])).toEqual(EXPECTED.map((e) => [e.name, e.type]))
  })

  it('defaults every descriptor', () => {
    expect(inputs().map((p) => [p.name, p.defaultValue])).toEqual(
      EXPECTED.map((e) => [e.name, e.defaultValue]),
    )
  })

  it.each(EXPECTED.map((expected, index) => [index + 1, expected.name, expected] as const))(
    'declares row %i (%s) with exactly its pinned keys',
    (position, _name, expected) => {
      expect(inputs()).toHaveLength(DESCRIPTOR_COUNT)
      expect(inputs()[position - 1]).toEqual(expected)
    },
  )

  it.each(Object.entries(DESCRIPTIONS))('describes %s with its Details page sentence', (name, description) => {
    const rows = inputsNamed(name)
    expect(rows.length, `descriptors named ${name}`).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row.description).toBe(description)
    }
  })

  it('keeps the shared descriptions on the four TLS rows and On error', () => {
    const shared = [...tlsTrustInputs(TLS_GROUP), failureHandlingOnErrorInput()]
    for (const row of shared) {
      expect(single(row.name).description, row.name).toBe(row.description)
    }
  })
})

describe('the expression toggle (OS-1, OS-4, OS-5)', () => {
  it('hides the {} toggle on Query language, Mode and On error only', () => {
    expect(inputs()).toHaveLength(DESCRIPTOR_COUNT)
    expect(carrying('noExpression')).toEqual([
      ['query_language', true],
      ['mode', true],
      ['on_error', true],
    ])
  })

  it('offers the {} toggle on both Query twins', () => {
    expect(queryTwins().map((p) => p.noExpression)).toEqual([undefined, undefined])
  })
})

describe('selects (OS-1, OS-5, OS-6, OS-7)', () => {
  it('renders a select only for Query language, Mode, Group by time, Order and On error', () => {
    expect(inputs()).toHaveLength(DESCRIPTOR_COUNT)
    expect(inputs().filter((p) => p.enumValues !== undefined).map((p) => p.name)).toEqual([
      'query_language',
      'mode',
      'group_by_time',
      'order',
      'on_error',
    ])
  })

  it('offers DQL and Query DSL under Query language, DQL first and by default', () => {
    const language = single('query_language')
    expect(language.enumValues).toEqual(['dql', 'query_dsl'])
    expect(optionLabels(language)).toEqual(['DQL', 'Query DSL'])
    expect(language.defaultValue).toBe('dql')
  })

  it('offers Search and Aggregate under Mode, Search by default', () => {
    const mode = single('mode')
    expect(mode.enumValues).toEqual(['search', 'aggregate'])
    expect(optionLabels(mode)).toEqual(['Search', 'Aggregate'])
    expect(mode.defaultValue).toBe('search')
  })

  it('offers No and the six time slots under Group by time, Every 1 minute by default', () => {
    const groupByTime = single('group_by_time')
    expect(groupByTime.enumValues).toEqual(['none', '10s', '30s', '1m', '5m', '15m', '1h'])
    expect(optionLabels(groupByTime)).toEqual([
      'No',
      'Every 10 seconds',
      'Every 30 seconds',
      'Every 1 minute',
      'Every 5 minutes',
      'Every 15 minutes',
      'Every 1 hour',
    ])
    expect(groupByTime.defaultValue).toBe('1m')
  })

  it('offers Newest first and Oldest first under Order, Newest first by default', () => {
    const order = single('order')
    expect(order.enumValues).toEqual(['desc', 'asc'])
    expect(optionLabels(order)).toEqual(['Newest first', 'Oldest first'])
    expect(order.defaultValue).toBe('desc')
  })

  it('uses the shared On error row', () => {
    expect(single('on_error')).toEqual(failureHandlingOnErrorInput())
  })
})

describe('Query twins (REQ-3.3.2.2, REQ-3.3.2.6, REQ-3.3.3.6, OS-5, OS-12)', () => {
  it('declares two Query rows sharing the wire name, the label, the type and the description', () => {
    expect(queryTwins().map((p) => [p.name, label(p), p.type, p.required, p.description])).toEqual([
      ['query', 'Query', 'string', false, DESCRIPTIONS.query],
      ['query', 'Query', 'string', false, DESCRIPTIONS.query],
    ])
  })

  it('locks the DQL twin to the dql editor and the Query DSL twin to the query-dsl editor', () => {
    expect(queryTwins().map((p) => [p.showWhen, p.allowedFormats])).toEqual([
      [DQL, ['dql']],
      [DSL, ['query-dsl']],
    ])
  })

  it('opens both twins in Template kind when blank', () => {
    expect(queryTwins().map((p) => p.templateByDefault)).toEqual([true, true])
  })

  it('keeps no twin draft across a hide, so the other language reads the same text', () => {
    expect(queryTwins().map((p) => p.retainOnHide)).toEqual([undefined, undefined])
  })

  it('shows exactly one Query row in every state', () => {
    expect(inputsNamed('query').length).toBeGreaterThan(1)
    for (const values of GATE_GRID) {
      expect(visibleNamed('query', values), JSON.stringify(values)).toHaveLength(1)
    }
  })

  it('shows the DQL twin on a fresh block, as Query language reads DQL while unset', () => {
    const [dql] = queryTwins()
    expect(visibleNamed('query', {})).toEqual([dql])
    expect(matchesCondition(DQL, {}, table())).toBe(true)
  })

  it('shows the Query DSL twin while Query language is Query DSL', () => {
    const [, dsl] = queryTwins()
    expect(visibleNamed('query', { query_language: 'query_dsl' })).toEqual([dsl])
  })

  it('requires neither twin, since an empty Query means no filter', () => {
    for (const values of GATE_GRID) {
      expect(requiredNames(values), JSON.stringify(values)).not.toContain('query')
    }
  })
})

describe('mode rows (REQ-3.3.3.1, REQ-3.3.3.2, OS-1, OS-6, OS-7)', () => {
  it('gates Fields, Max results, Sort by and Order on Search', () => {
    expect(inputs()).toHaveLength(DESCRIPTOR_COUNT)
    expect(
      inputs()
        .filter((p) => p.showWhen?.field === 'mode' && p.showWhen.values.join() === 'search')
        .map((p) => p.name),
    ).toEqual(['fields', 'max_results', 'sort_by', 'order'])
  })

  it('gates Group by time, Group by field, Top values and Stats on Aggregate', () => {
    expect(inputs()).toHaveLength(DESCRIPTOR_COUNT)
    expect(
      inputs()
        .filter((p) => p.showWhen?.field === 'mode' && p.showWhen.values.join() === 'aggregate')
        .map((p) => p.name),
    ).toEqual(['group_by_time', 'group_by_field', 'top_values', 'stats'])
  })

  it('gates only the mode rows and the Query twins', () => {
    expect(inputs()).toHaveLength(DESCRIPTOR_COUNT)
    expect(carrying('showWhen')).toEqual([
      ['query', DQL],
      ['query', DSL],
      ['fields', SEARCH],
      ['max_results', SEARCH],
      ['group_by_time', AGGREGATE],
      ['group_by_field', AGGREGATE],
      ['top_values', AGGREGATE],
      ['stats', AGGREGATE],
      ['sort_by', SEARCH],
      ['order', SEARCH],
    ])
  })

  it('uses no conjunctive, disjunctive or conditional-required gate', () => {
    expect(inputs()).toHaveLength(DESCRIPTOR_COUNT)
    for (const p of inputs()) {
      expect(p.showWhenAll, `showWhenAll of ${p.name}`).toBeUndefined()
      expect(p.showWhenAny, `showWhenAny of ${p.name}`).toBeUndefined()
      expect(p.requiredWhen, `requiredWhen of ${p.name}`).toBeUndefined()
      expect(p.requiredWhenAll, `requiredWhenAll of ${p.name}`).toBeUndefined()
    }
  })

  it('keeps the other mode\'s drafts until Save on every mode row, and on no other row', () => {
    expect(inputs()).toHaveLength(DESCRIPTOR_COUNT)
    expect(inputs().filter((p) => p.retainOnHide === true).map((p) => p.name)).toEqual([
      'fields',
      'max_results',
      'group_by_time',
      'group_by_field',
      'top_values',
      'stats',
      'sort_by',
      'order',
    ])
  })

  it('opens Fields with @timestamp and Stats with Count', () => {
    expect(single('fields').defaultValue).toEqual([{ value: '@timestamp' }])
    expect(single('stats').defaultValue).toEqual([{ value: { stat: 'count' } }])
  })

  it('edits Fields as field entries and Stats as stat entries, with bare positions', () => {
    expect(inputs()).toHaveLength(DESCRIPTOR_COUNT)
    expect(carrying('orderedList')).toEqual([
      ['fields', { itemNoun: 'field', positionPrefix: '', entry: 'field' }],
      ['stats', { itemNoun: 'stat', positionPrefix: '', entry: 'stat' }],
    ])
  })
})

describe('row widgets (REQ-3.3.2.3, REQ-3.3.2.5, OS-3, OS-4, OS-5, OS-13)', () => {
  it('shows the From / To time value on From and To only', () => {
    expect(inputs()).toHaveLength(DESCRIPTOR_COUNT)
    expect(carrying('timeValue')).toEqual([
      ['from', true],
      ['to', true],
    ])
  })

  it('defaults From to 15 minutes ago and To to now', () => {
    expect(single('from').defaultValue).toBe('now-15m')
    expect(single('to').defaultValue).toBe('now')
  })

  it('suggests indexes on Index pattern and fields of the right kind on Group by field, Sort by and Time field', () => {
    expect(inputs()).toHaveLength(DESCRIPTOR_COUNT)
    expect(carrying('fieldSuggest')).toEqual([
      ['index', { source: 'indexes' }],
      ['group_by_field', { source: 'fields', types: 'aggregatable' }],
      ['sort_by', { source: 'fields', types: 'aggregatable' }],
      ['time_field', { source: 'fields', types: 'date' }],
    ])
  })

  it('seeds Template kind on the two Query twins only', () => {
    expect(inputs()).toHaveLength(DESCRIPTOR_COUNT)
    expect(carrying('templateByDefault')).toEqual([
      ['query', true],
      ['query', true],
    ])
  })

  it('defaults Time field to @timestamp', () => {
    expect(single('time_field').defaultValue).toBe('@timestamp')
  })

  it('shows a placeholder on Cluster URL, Index pattern, Group by field and Sort by only', () => {
    expect(inputs()).toHaveLength(DESCRIPTOR_COUNT)
    expect(carrying('placeholder')).toEqual([
      ['url', 'https://opensearch.internal:9200'],
      ['index', 'logs-*'],
      ['group_by_field', 'No field'],
      ['sort_by', 'Time field'],
    ])
  })

  it('locks the Query twins to their editors and the URL, credential and certificate rows to plain text', () => {
    expect(inputs()).toHaveLength(DESCRIPTOR_COUNT)
    expect(carrying('allowedFormats')).toEqual([
      ['url', ['plain']],
      ['query', ['dql']],
      ['query', ['query-dsl']],
      ['password', ['plain']],
      ['api_key', ['plain']],
      ['bearer_token', ['plain']],
      ['ca_cert', ['plain']],
      ['client_cert', ['plain']],
      ['client_key', ['plain']],
    ])
  })

  it('opens no file picker and no variable selector on any row', () => {
    expect(inputs()).toHaveLength(DESCRIPTOR_COUNT)
    expect(carrying('fileReference')).toEqual([])
    expect(carrying('variableRef')).toEqual([])
  })
})

describe('row notes (OS-2, OS-4)', () => {
  it('attaches a row note to From, API Key, Bearer Token and the four TLS rows only', () => {
    expect(inputs()).toHaveLength(DESCRIPTOR_COUNT)
    expect(inputs().filter((p) => p.rowNote !== undefined).map((p) => p.name)).toEqual([
      'from',
      'api_key',
      'bearer_token',
      'verify_ssl',
      'ca_cert',
      'client_cert',
      'client_key',
    ])
  })

  it('names the From note on From', () => {
    expect(single('from').rowNote).toBe(fromNote)
  })

  it('names the ApiKey scheme note on API Key and the Bearer scheme note on Bearer Token', () => {
    expect(single('api_key').rowNote).toBe(apiKeySchemeNote)
    expect(single('bearer_token').rowNote).toBe(bearerSchemeNote)
  })

  it.each(['verify_ssl', 'ca_cert', 'client_cert', 'client_key'])('names the http note on %s', (name) => {
    expect(single(name).rowNote).toBe(tlsOnHttpNote)
  })

  it('carries no note on To', () => {
    expect(single('to').rowNote).toBeUndefined()
  })
})

describe('TLS rows (REQ-5.1.4, OS-2)', () => {
  it('builds the four TLS rows from the shared trust rows, adding only the http note', () => {
    const shared = tlsTrustInputs(TLS_GROUP)
    const rows = inputs().filter((p) => p.group === TLS_GROUP)
    expect(rows).toHaveLength(4)
    expect(rows.map(({ rowNote, ...rest }) => [rest, rowNote])).toEqual(
      shared.map((row) => [row, tlsOnHttpNote]),
    )
  })

  it('shows the TLS rows whatever the URL scheme: no TLS switch gates them', () => {
    expect(inputsNamed('tls')).toEqual([])
    for (const row of inputs().filter((p) => p.group === TLS_GROUP)) {
      expect(row.showWhen, row.name).toBeUndefined()
    }
  })

  it('verifies the server certificate by default', () => {
    expect(single('verify_ssl').defaultValue).toBe(true)
  })
})

describe('numeric bounds (OS-6, OS-7, OS-11)', () => {
  it('builds the Timeout row with the shared builder at 300 seconds', () => {
    const timeout = single('timeout')
    expect(timeout).toEqual(timeoutInput(300, DESCRIPTIONS.timeout))
    expect(timeout.minimum).toBe(1)
    expect(timeout.maximum).toBeUndefined()
  })

  it.each([
    ['max_results', 0],
    ['top_values', 1],
    ['connect_timeout', 1],
  ])('declares a lowest value on %s of %d and no highest value', (name, minimum) => {
    const entry = single(name)
    expect(entry.minimum).toBe(minimum)
    expect(entry.maximum).toBeUndefined()
    expect(entry.maximumField).toBeUndefined()
  })

  it('leaves every other row unbounded', () => {
    const bounded = new Set(['timeout', 'max_results', 'top_values', 'connect_timeout'])
    const others = inputs().filter((p) => !bounded.has(p.name))
    expect(others).toHaveLength(24)
    for (const p of others) {
      expect(p.minimum, `minimum of ${p.name}`).toBeUndefined()
      expect(p.maximum, `maximum of ${p.name}`).toBeUndefined()
      expect(p.maximumField, `maximumField of ${p.name}`).toBeUndefined()
    }
  })

  it('defaults Max results to 10000, Top values to 10 and Connect timeout to 30', () => {
    expect([
      single('max_results').defaultValue,
      single('top_values').defaultValue,
      single('connect_timeout').defaultValue,
    ]).toEqual([10000, 10, 30])
  })
})

describe('credentials (REQ-3.1.3.16, OS-2)', () => {
  it('marks only Password, API Key, Bearer Token and Client Key secret', () => {
    expect(inputs()).toHaveLength(DESCRIPTOR_COUNT)
    expect(inputs().filter((p) => p.secret === true).map((p) => p.name)).toEqual([
      'password',
      'api_key',
      'bearer_token',
      'client_key',
    ])
  })

  it('declares the mask fields Password, API Key, Bearer Token and Client Key, in that order', () => {
    expect(getSecretMaskFields(ID)).toEqual([
      { key: 'password', label: 'Password' },
      { key: 'api_key', label: 'API Key' },
      { key: 'bearer_token', label: 'Bearer Token' },
      { key: 'client_key', label: 'Client Key' },
    ])
  })

  it('names exactly the secret rows among the mask fields', () => {
    const secretRows = inputs()
      .filter((p) => p.secret === true)
      .map((p) => p.name)
    expect(secretRows.length).toBeGreaterThan(0)
    expect((getSecretMaskFields(ID) ?? []).map((f) => f.key)).toEqual(secretRows)
  })

  it('places Username, Password, API Key and Bearer Token in Authentication', () => {
    expect(inputs().filter((p) => p.group === AUTH).map((p) => p.name)).toEqual([
      'username',
      'password',
      'api_key',
      'bearer_token',
    ])
  })
})

describe('groups (OS-2, OS-6)', () => {
  it('declares Sort, Authentication, TLS / Certificates, Advanced and Failure Handling, in that order', () => {
    expect(Object.keys(getGroupMeta(ID) ?? {})).toEqual([SORT, AUTH, TLS_GROUP, ADVANCED, FAILURE_HANDLING_GROUP])
  })

  it('keeps every group collapsed, gives Authentication its footer and uses the shared Failure Handling group', () => {
    expect(getGroupMeta(ID)).toEqual({
      [SORT]: group(SORT),
      [AUTH]: group(AUTH, { description: AUTH_DESCRIPTION }),
      [TLS_GROUP]: group(TLS_GROUP),
      [ADVANCED]: group(ADVANCED),
      [FAILURE_HANDLING_GROUP]: failureHandlingGroup(),
    })
  })

  it('leaves the top rows ungrouped and groups each of the others', () => {
    expect(inputs().map((p) => [p.name, p.group])).toEqual(EXPECTED.map((e) => [e.name, e.group]))
  })
})

describe('sheet per state (OS-1, OS-6, OS-7)', () => {
  it.each(STATES)('shows the top rows of %s in order', (_title, s) => {
    expect(sheet(s.values).top).toEqual(s.top)
  })

  it.each(STATES)('shows the Query twin of %s', (_title, s) => {
    const query = visibleNamed('query', s.values)
    expect(query).toHaveLength(1)
    expect(query[0].allowedFormats).toEqual([s.queryFormat])
  })

  it.each(STATES)('fills the Sort group of %s', (_title, s) => {
    expect(visibleRows(s.values).length).toBeGreaterThan(0)
    expect(sheet(s.values).group(SORT)).toEqual(s.sort)
  })

  it.each(STATES)('fills Authentication, TLS / Certificates and Advanced the same way in %s', (_title, s) => {
    const view = sheet(s.values)
    expect([view.group(AUTH), view.group(TLS_GROUP), view.group(ADVANCED)]).toEqual([
      AUTH_ROWS,
      TLS_ROWS,
      ADVANCED_ROWS,
    ])
  })

  it.each(STATES)('keeps On error in Failure Handling in %s', (_title, s) => {
    expect(sheet(s.values).group(FAILURE_HANDLING_GROUP)).toEqual(['On error'])
  })

  it.each(STATES)('renders the groups of %s in order', (_title, s) => {
    expect(sheet(s.values).groupOrder).toEqual(s.groupOrder)
  })

  it.each(STATES)('requires exactly Cluster URL and Index pattern in %s', (_title, s) => {
    expect(requiredNames(s.values)).toEqual(['url', 'index'])
  })

  it('requires Cluster URL and Index pattern outright', () => {
    expect([single('url').required, single('index').required]).toEqual([true, true])
    expect(inputs().filter((p) => p.required).map((p) => p.name)).toEqual(['url', 'index'])
  })

  it('reads an unset Mode as Search', () => {
    expect(inputs()).toHaveLength(DESCRIPTOR_COUNT)
    expect(matchesCondition(SEARCH, {}, table())).toBe(true)
    expect(matchesCondition(AGGREGATE, {}, table())).toBe(false)
  })
})

describe('outputs (OS-8, OS-11)', () => {
  it('declares Success, Results, Total results, Error and Reason with their types, in that order', () => {
    expect(outputs().map((o) => [o.name, o.type])).toEqual([
      ['success', 'boolean'],
      ['results', 'table'],
      ['total_results', 'integer'],
      ['error', 'string'],
      ['reason', 'string'],
    ])
  })

  it('labels every output', () => {
    expect(outputs().map(label)).toEqual(['Success', 'Results', 'Total results', 'Error', 'Reason'])
  })

  it('builds Success, Error and Reason from the output core with the OpenSearch wording', () => {
    const [success, error, reason] = outputCore({
      successDescription: 'True when the block finished; false when the block failed and On error is Record and continue',
      reasonDescription: 'Unreachable, AuthFailed, RequestFailed, Timeout or Validation; empty when the block passed',
    })
    expect(outputs()).toHaveLength(OUTPUT_COUNT)
    expect([outputs()[0], outputs()[3], outputs()[4]]).toEqual([success, error, reason])
  })

  it('describes Results and Total results exactly', () => {
    expect(outputs()).toHaveLength(OUTPUT_COUNT)
    expect([outputs()[1], outputs()[2]]).toEqual([
      output(
        'results',
        'Results',
        'table',
        'A table. Search: one row per matching document and one column per entry in Fields. Aggregate: one row per time slot and / or field value, or one row for the whole window, with one column per stat.',
      ),
      output(
        'total_results',
        'Total results',
        'integer',
        'The exact number of matching documents, whatever Max results says.',
      ),
    ])
  })

  it.each([
    [{}, ['success', 'results', 'total_results']],
    [{ mode: 'search', on_error: 'fail' }, ['success', 'results', 'total_results']],
    [{ mode: 'aggregate', on_error: 'fail' }, ['success', 'results', 'total_results']],
    [{ mode: 'search', on_error: 'record' }, ['success', 'results', 'total_results', 'error', 'reason']],
    [{ mode: 'aggregate', on_error: 'record' }, ['success', 'results', 'total_results', 'error', 'reason']],
  ])('offers the outputs for %o', (values, expected) => {
    expect(visibleOutputs(values)).toEqual(expected)
  })

  it('marks no output secret and gives none a type rule', () => {
    expect(outputs()).toHaveLength(OUTPUT_COUNT)
    expect(outputs().filter((o) => o.secret === true).map((o) => o.name)).toEqual([])
    expect(outputs().filter((o) => o.typeWhen !== undefined).map((o) => o.name)).toEqual([])
  })
})

describe('palette and icon (REQ-3.4.1.15, OS-14)', () => {
  it('keeps the OpenSearch palette row in the Database category', () => {
    const def = getPluginById(ID)
    expect(def).toBeDefined()
    expect(def!.name).toBe('OpenSearch')
    expect(def!.category).toBe('database')
    expect(def!.iconName).toBe('SearchCode')
    expect(def!.colorClass).toBe('text-purple-500')
  })

  it('runs on a remote host inside a Remote Execution body', () => {
    expect(getPluginById(ID)?.remotable).toBe(true)
  })

  it('keeps the SearchCode glyph and the purple color on the canvas', () => {
    expect(getIcon(ID)).toBe(SearchCode)
    expect(getIconName(ID)).toBe('search-code')
    expect(getColorClass(ID)).toBe('text-purple-500')
  })
})
