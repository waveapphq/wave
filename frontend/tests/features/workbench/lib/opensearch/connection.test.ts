/**
 * OpenSearch connection helpers: the eleven connection rows a pull sends as the block holds them (no default
 * copies) and the Get fields request.
 *
 * REQ-3.4.1.15, REQ-3.3.2.5; OS-2, OS-13, OS-15
 */

import { describe, it, expect } from 'vitest'

import {
  FILL_IN_INDEX_PATTERN,
  indexPatternIsBlank,
  openSearchConnectionOf,
  openSearchFieldsRequestOf,
} from '@/features/workbench/lib/opensearch/connection'
import type { ProfileBinding } from '@/features/workbench/common/element-config/dialogs/profile-binding-modal'
import { SAMPLE_FIELDS_REQUEST, SAMPLE_OS_CONNECTION } from '../../opensearch-fixtures'

const CONNECTION_KEYS = [
  'api_key',
  'bearer_token',
  'ca_cert',
  'client_cert',
  'client_key',
  'connect_timeout',
  'index',
  'password',
  'url',
  'username',
  'verify_ssl',
]

const REQUEST_KEYS = [
  'connection',
  'element_types',
  'environment_id',
  'expression_fields',
  'profile_bindings',
  'template_fields',
  'test_id',
]

const SEALED_PASSWORD = 'wave:enc:v1:c2VhbGVkLXBhc3N3b3Jk'
const SEALED_API_KEY = 'wave:enc:v1:c2VhbGVkLWFwaS1rZXk='
const SEALED_CLIENT_KEY = 'wave:enc:v1:c2VhbGVkLWNsaWVudC1rZXk='

const LOGS_CLUSTER_BINDING = {
  profileId: 'profile-logs-cluster',
  alias: 'logs_cluster',
  profileName: 'Logs cluster',
  profileType: 'opensearch',
}

/** The values of a Search block with literal rows, every non-connection row set too. */
const SEARCH_VALUES: Record<string, unknown> = {
  url: 'https://opensearch.example:9200',
  index: 'filebeat-*',
  from: 'now-15m',
  to: 'now',
  query_language: 'dql',
  query: 'log.level: ERROR',
  mode: 'search',
  fields: [{ value: '@timestamp' }, { value: 'message' }],
  max_results: 10000,
  timeout: 300,
  sort_by: '@timestamp',
  order: 'desc',
  username: 'wave',
  password: 'os-secret',
  verify_ssl: true,
  time_field: '@timestamp',
  on_error: 'fail',
}

/** What a pull puts on the wire: a row the connection leaves undefined is not sent. */
function sentRows(connection: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(connection)) as Record<string, unknown>
}

/** The connection rows SEARCH_VALUES holds, exactly as the block holds them. */
const SEARCH_CONNECTION = {
  url: 'https://opensearch.example:9200',
  username: 'wave',
  password: 'os-secret',
  verify_ssl: true,
  index: 'filebeat-*',
}

describe('openSearchConnectionOf', () => {
  it('sends no row when the values hold none: the server fills every default (REQ-3.3.2.5)', () => {
    expect(sentRows(openSearchConnectionOf({}))).toEqual({})
  })

  it('sends no Verify Server Certificate, Connect timeout or Index pattern the block does not hold', () => {
    expect(sentRows(openSearchConnectionOf({ url: 'http://localhost:9200' }))).toEqual({
      url: 'http://localhost:9200',
    })
  })

  it('copies the rows of a literal Search block', () => {
    expect(sentRows(openSearchConnectionOf(SEARCH_VALUES))).toEqual(SEARCH_CONNECTION)
  })

  it('carries only the connection rows the block holds and no other value', () => {
    const otherRows = {
      mode: 'aggregate',
      group_by_time: '1m',
      group_by_field: 'service.name',
      top_values: 10,
      stats: [{ value: { stat: 'count' } }],
    }
    const everyRow = {
      ...SEARCH_VALUES,
      ...otherRows,
      api_key: '',
      bearer_token: '',
      ca_cert: '',
      client_cert: '',
      client_key: '',
      connect_timeout: 30,
    }

    expect(Object.keys(sentRows(openSearchConnectionOf(everyRow))).sort()).toEqual(CONNECTION_KEYS)
    expect(Object.keys(sentRows(openSearchConnectionOf({ ...SEARCH_VALUES, ...otherRows }))).sort()).toEqual(
      Object.keys(SEARCH_CONNECTION).sort(),
    )
  })

  it('leaves out Time field, Query and the window, which Get fields does not read', () => {
    const connection = openSearchConnectionOf(SEARCH_VALUES) as unknown as Record<string, unknown>

    for (const row of ['time_field', 'query', 'query_language', 'from', 'to', 'mode', 'timeout']) {
      expect(connection, row).not.toHaveProperty(row)
    }
  })

  it('keeps Verify Server Certificate off when it is turned off', () => {
    expect(openSearchConnectionOf({ verify_ssl: false }).verify_ssl).toBe(false)
  })

  it('keeps Connect timeout as set', () => {
    expect(openSearchConnectionOf({ connect_timeout: 45 }).connect_timeout).toBe(45)
  })

  it('copies an API key and a bearer token as they sit', () => {
    const connection = openSearchConnectionOf({ api_key: 'a2V5', bearer_token: 'eyJhbGciOi' })

    expect(connection.api_key).toBe('a2V5')
    expect(connection.bearer_token).toBe('eyJhbGciOi')
  })

  it('copies sealed secrets, expression text, template text and blank rows as they sit', () => {
    const connection = openSearchConnectionOf({
      url: '{{ cluster_url }}',
      username: '',
      password: SEALED_PASSWORD,
      api_key: SEALED_API_KEY,
      bearer_token: '',
      verify_ssl: '{{ verify_tls }}',
      ca_cert: 'testdata://certs/ca.pem',
      client_cert: '',
      client_key: SEALED_CLIENT_KEY,
      index: 'logs-{{ env_suffix }}-*',
      connect_timeout: '{{ connect_seconds }}',
    })

    expect(connection).toEqual({
      url: '{{ cluster_url }}',
      username: '',
      password: SEALED_PASSWORD,
      api_key: SEALED_API_KEY,
      bearer_token: '',
      verify_ssl: '{{ verify_tls }}',
      ca_cert: 'testdata://certs/ca.pem',
      client_cert: '',
      client_key: SEALED_CLIENT_KEY,
      index: 'logs-{{ env_suffix }}-*',
      connect_timeout: '{{ connect_seconds }}',
    })
  })

  it('leaves out every credential row the block does not hold, so the server reads it as nothing given (REQ-3.1.3.21)', () => {
    const sent = JSON.parse(JSON.stringify(openSearchConnectionOf({ url: 'http://localhost:9200', username: 'wave' })))

    for (const row of ['password', 'api_key', 'bearer_token', 'client_key']) {
      expect(sent, row).not.toHaveProperty(row)
    }
    expect(sent.username).toBe('wave')
  })

  it('sends a credential row holding null as null, so the server refuses it as a run does (REQ-3.1.3.21)', () => {
    const connection = openSearchConnectionOf({ password: null, api_key: null, bearer_token: null, client_key: null })

    expect([connection.password, connection.api_key, connection.bearer_token, connection.client_key]).toEqual([
      null,
      null,
      null,
      null,
    ])
  })

  it('does not change the values it reads', () => {
    const values = { url: 'http://localhost:9200', index: 'app-logs' }

    openSearchConnectionOf(values)

    expect(values).toEqual({ url: 'http://localhost:9200', index: 'app-logs' })
  })
})

describe('openSearchFieldsRequestOf', () => {
  it('wraps the connection rows with the pull context', () => {
    const request = openSearchFieldsRequestOf({
      values: SEARCH_VALUES,
      expressionFields: [],
      templateFields: [],
      profileBindings: [],
      environmentId: null,
      testId: null,
    })

    expect(sentRows(request)).toEqual({ ...SAMPLE_FIELDS_REQUEST, connection: SEARCH_CONNECTION })
  })

  it('holds exactly the seven request fields and never refresh', () => {
    const request = openSearchFieldsRequestOf({
      values: SEARCH_VALUES,
      expressionFields: [],
      templateFields: [],
      profileBindings: [],
      environmentId: 'env-lab',
      testId: 'test-logs',
    })

    expect(Object.keys(request).sort()).toEqual(REQUEST_KEYS)
  })

  it('builds the connection with openSearchConnectionOf', () => {
    const values = { url: '{{ cluster_url }}', index: 'app-logs', verify_ssl: false, query: 'status: 500' }

    const request = openSearchFieldsRequestOf({
      values,
      expressionFields: [],
      templateFields: [],
      profileBindings: [],
      environmentId: null,
      testId: null,
    })

    expect(request.connection).toEqual(openSearchConnectionOf(values))
  })

  it('keeps only the connection rows among the expression fields, in their given order', () => {
    const request = openSearchFieldsRequestOf({
      values: SEARCH_VALUES,
      expressionFields: [
        'query',
        'url',
        'from',
        'index',
        'fields.0.value',
        'connect_timeout',
        'time_field',
        'stats.1.value',
        'verify_ssl',
      ],
      templateFields: [],
      profileBindings: [],
      environmentId: 'env-lab',
      testId: 'test-logs',
    })

    expect(request.expression_fields).toEqual(['url', 'index', 'connect_timeout', 'verify_ssl'])
  })

  it('keeps only the connection rows among the template fields, in their given order', () => {
    const request = openSearchFieldsRequestOf({
      values: SEARCH_VALUES,
      expressionFields: [],
      templateFields: ['query', 'index', 'sort_by', 'username', 'to'],
      profileBindings: [],
      environmentId: 'env-lab',
      testId: 'test-logs',
    })

    expect(request.template_fields).toEqual(['index', 'username'])
  })

  it('sends no element types: no connection row holds typed values', () => {
    const request = openSearchFieldsRequestOf({
      values: SEARCH_VALUES,
      expressionFields: [],
      templateFields: [],
      profileBindings: [],
    })

    expect(request.element_types).toEqual({})
  })

  it('carries the block profile bindings as stored', () => {
    const request = openSearchFieldsRequestOf({
      values: SEARCH_VALUES,
      expressionFields: [],
      templateFields: [],
      profileBindings: [LOGS_CLUSTER_BINDING],
      environmentId: 'env-lab',
      testId: 'test-logs',
    })

    expect(request.profile_bindings).toEqual([LOGS_CLUSTER_BINDING])
  })

  it('sends only the id, alias, name and type of a binding, never its schema fields', () => {
    const stored: ProfileBinding = {
      ...LOGS_CLUSTER_BINDING,
      fields: [
        { name: 'url', type: 'string' },
        { name: 'password', type: 'string' },
      ],
    }

    const request = openSearchFieldsRequestOf({
      values: SEARCH_VALUES,
      expressionFields: [],
      templateFields: [],
      profileBindings: [stored],
    })

    expect(request.profile_bindings).toEqual([LOGS_CLUSTER_BINDING])
    expect(Object.keys(request.profile_bindings[0]).sort()).toEqual([
      'alias',
      'profileId',
      'profileName',
      'profileType',
    ])
  })

  it('carries the Environment and the test', () => {
    const request = openSearchFieldsRequestOf({
      values: SEARCH_VALUES,
      expressionFields: [],
      templateFields: [],
      profileBindings: [],
      environmentId: 'env-staging',
      testId: 'test-logs',
    })

    expect(request.environment_id).toBe('env-staging')
    expect(request.test_id).toBe('test-logs')
  })

  it('sends null for an Environment and a test that are absent', () => {
    const request = openSearchFieldsRequestOf({
      values: SEARCH_VALUES,
      expressionFields: [],
      templateFields: [],
      profileBindings: [],
    })

    expect(request.environment_id).toBeNull()
    expect(request.test_id).toBeNull()
  })

  it('does not change the lists it reads', () => {
    const expressionFields = ['query', 'url']
    const templateFields = ['index', 'query']
    const profileBindings = [LOGS_CLUSTER_BINDING]

    openSearchFieldsRequestOf({ values: SEARCH_VALUES, expressionFields, templateFields, profileBindings })

    expect(expressionFields).toEqual(['query', 'url'])
    expect(templateFields).toEqual(['index', 'query'])
    expect(profileBindings).toEqual([LOGS_CLUSTER_BINDING])
  })
})

// A field list needs an Index pattern: every fields surface waits while it is blank as written.
describe('indexPatternIsBlank', () => {
  function requestWith(index: unknown, flags: { expression?: string[]; template?: string[] } = {}) {
    return {
      ...SAMPLE_FIELDS_REQUEST,
      connection: { ...SAMPLE_OS_CONNECTION, index },
      expression_fields: flags.expression ?? [],
      template_fields: flags.template ?? [],
    }
  }

  it.each([
    ['empty', ''],
    ['only spaces', '   '],
    ['a tab and a newline', '\t\n'],
    ['absent', null],
  ])('is blank when the literal Index pattern is %s', (_label, index) => {
    expect(indexPatternIsBlank(requestWith(index))).toBe(true)
  })

  it.each([
    ['a wildcard', 'logs-*'],
    ['a padded name', '  app-logs  '],
  ])('is not blank for %s', (_label, index) => {
    expect(indexPatternIsBlank(requestWith(index))).toBe(false)
  })

  it('is not blank while the row is an expression, even an empty one', () => {
    expect(indexPatternIsBlank(requestWith('', { expression: ['index'] }))).toBe(false)
    expect(indexPatternIsBlank(requestWith('index_name', { expression: ['index'] }))).toBe(false)
  })

  it('is not blank while the row is a template', () => {
    expect(indexPatternIsBlank(requestWith('{{ prefix }}-*', { template: ['index'] }))).toBe(false)
  })

  it('reads only the Index pattern flags, not those of other rows', () => {
    expect(indexPatternIsBlank(requestWith('', { expression: ['url'], template: ['username'] }))).toBe(true)
  })

  it('reads the request the block builds from its values', () => {
    const request = openSearchFieldsRequestOf({
      values: { ...SEARCH_VALUES, index: ' ' },
      expressionFields: [],
      templateFields: [],
      profileBindings: [],
    })

    expect(indexPatternIsBlank(request)).toBe(true)
  })

  it('is blank for a block that never set its Index pattern', () => {
    const values = Object.fromEntries(Object.entries(SEARCH_VALUES).filter(([name]) => name !== 'index'))
    const request = openSearchFieldsRequestOf({ values, expressionFields: [], templateFields: [], profileBindings: [] })

    expect(indexPatternIsBlank(request)).toBe(true)
  })

  it('names the Index pattern in the words the fields surfaces show', () => {
    expect(FILL_IN_INDEX_PATTERN).toBe('Fill in Index pattern to get fields')
  })

  it('is blank when the Index pattern is undefined', () => {
    expect(indexPatternIsBlank(requestWith(undefined))).toBe(true)
  })

  it.each([
    ['a number', 2024],
    ['a boolean', false],
    ['a map', { name: 'logs' }],
  ])('is not blank for %s', (_label, index) => {
    expect(indexPatternIsBlank(requestWith(index))).toBe(false)
  })
})
