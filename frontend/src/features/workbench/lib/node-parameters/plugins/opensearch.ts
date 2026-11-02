/**
 * OpenSearch Plugin Parameters (REQ-3.4.1.15, REQ-3.3.2.2, REQ-3.3.2.3, REQ-3.3.3.1, REQ-3.3.3.2, REQ-5.1.2; OS-1 to OS-16).
 */

import { apiKeySchemeNote, bearerSchemeNote, fromNote, tlsOnHttpNote } from '@/features/workbench/lib/opensearch/row-notes'
import { group, output, param, type GroupMeta, type InputParam, type OutputParam, type SecretMaskField } from '../types'
import {
  FAILURE_HANDLING_GROUP,
  failureHandlingGroup,
  failureHandlingOnErrorInput,
  outputCore,
  timeoutInput,
} from './_shared-params'
import { tlsTrustInputs } from './_tls-shared'

const SORT = 'Sort'
const AUTH = 'Authentication'
const TLS_GROUP = 'TLS / Certificates'
const ADVANCED = 'Advanced'

const SEARCH = { field: 'mode', values: ['search'] }
const AGGREGATE = { field: 'mode', values: ['aggregate'] }
const DQL = { field: 'query_language', values: ['dql'] }
const DSL = { field: 'query_language', values: ['query_dsl'] }

const QUERY_DESCRIPTION =
  'A DQL line or the query part of a Query DSL request; with {}, an expression that gives the query; empty means no filter'

// Two Query rows share the wire name so switching Query language keeps the text (OS-5)
function queryInput(format: string, showWhen: { field: string; values: string[] }): InputParam {
  return param('query', 'Query', 'string', false, QUERY_DESCRIPTION, {
    defaultValue: '',
    allowedFormats: [format],
    showWhen,
    templateByDefault: true,
  })
}

export const groups: Record<string, GroupMeta> = {
  [SORT]: group(SORT),
  [AUTH]: group(AUTH, {
    description:
      'How WAVE identifies itself to the cluster: a username and password, an API key, a bearer token, or none. A client certificate under TLS / Certificates can go with any of them.',
  }),
  [TLS_GROUP]: group(TLS_GROUP),
  [ADVANCED]: group(ADVANCED),
  [FAILURE_HANDLING_GROUP]: failureHandlingGroup(),
}

export const inputs: InputParam[] = [
  param('url', 'Cluster URL', 'string', true, "The cluster's REST address with scheme and port: https://opensearch.internal:9200", {
    placeholder: 'https://opensearch.internal:9200',
    allowedFormats: ['plain'],
  }),
  param('index', 'Index pattern', 'string', true, "Where to look: one index, a wildcard such as logs-*, a comma list, exclusions with a leading minus, an alias, a data stream, or a date-math name such as <logs-{now/d}> for today's daily index. Sent as written; OpenSearch resolves it", {
    placeholder: 'logs-*',
    fieldSuggest: { source: 'indexes' },
  }),
  param('from', 'From', 'string', false, 'Start of the window: Absolute, Relative or Now, or a variable or expression with {}', {
    defaultValue: 'now-15m',
    timeValue: true,
    rowNote: fromNote,
  }),
  param('to', 'To', 'string', false, 'End of the window: Absolute, Relative or Now, or a variable or expression with {}', {
    defaultValue: 'now',
    timeValue: true,
  }),
  param('query_language', 'Query language', 'string', false, 'DQL or Query DSL', {
    enumValues: ['dql', 'query_dsl'],
    enumLabels: { dql: 'DQL', query_dsl: 'Query DSL' },
    defaultValue: 'dql',
    noExpression: true,
  }),
  queryInput('dql', DQL),
  queryInput('query-dsl', DSL),
  param('mode', 'Mode', 'string', false, 'Search returns the matching documents; Aggregate returns numbers worked out from them', {
    enumValues: ['search', 'aggregate'],
    enumLabels: { search: 'Search', aggregate: 'Aggregate' },
    defaultValue: 'search',
    noExpression: true,
  }),
  // --- Search ---
  param('fields', 'Fields', 'array', false, 'The fields that come back, one column each, in this order; nested fields with dots, such as user.name. Empty returns the whole document as one column', {
    defaultValue: [{ value: '@timestamp' }],
    orderedList: { itemNoun: 'field', positionPrefix: '', entry: 'field' },
    showWhen: SEARCH,
    retainOnHide: true,
  }),
  param('max_results', 'Max results', 'integer', false, 'Lines Results keeps; 0 keeps every line', {
    defaultValue: 10000,
    minimum: 0,
    showWhen: SEARCH,
    retainOnHide: true,
  }),
  // --- Aggregate ---
  param('group_by_time', 'Group by time', 'string', false, 'No, or Every 10 seconds, 30 seconds, 1 minute, 5 minutes, 15 minutes or 1 hour', {
    enumValues: ['none', '10s', '30s', '1m', '5m', '15m', '1h'],
    enumLabels: {
      none: 'No',
      '10s': 'Every 10 seconds',
      '30s': 'Every 30 seconds',
      '1m': 'Every 1 minute',
      '5m': 'Every 5 minutes',
      '15m': 'Every 15 minutes',
      '1h': 'Every 1 hour',
    },
    defaultValue: '1m',
    showWhen: AGGREGATE,
    retainOnHide: true,
  }),
  param('group_by_field', 'Group by field', 'string', false, 'A field whose values each get their own rows', {
    defaultValue: '',
    placeholder: 'No field',
    fieldSuggest: { source: 'fields', types: 'aggregatable' },
    showWhen: AGGREGATE,
    retainOnHide: true,
  }),
  param('top_values', 'Top values', 'integer', false, "How many of the grouped field's most common values get rows", {
    defaultValue: 10,
    minimum: 1,
    showWhen: AGGREGATE,
    retainOnHide: true,
  }),
  param('stats', 'Stats', 'array', false, 'The numbers to work out, one column each: Count, Sum, Average, Min, Max, Percentile, Unique count, Increase or Custom (JSON)', {
    defaultValue: [{ value: { stat: 'count' } }],
    orderedList: { itemNoun: 'stat', positionPrefix: '', entry: 'stat' },
    showWhen: AGGREGATE,
    retainOnHide: true,
  }),
  timeoutInput(300, 'Seconds for the whole block, paging included; when it runs out the search is ended on the cluster'),
  // --- Sort (Search) ---
  param('sort_by', 'Sort by', 'string', false, 'The field to sort on; any sortable field', {
    group: SORT,
    defaultValue: '',
    placeholder: 'Time field',
    fieldSuggest: { source: 'fields', types: 'aggregatable' },
    showWhen: SEARCH,
    retainOnHide: true,
  }),
  param('order', 'Order', 'string', false, 'Newest first or Oldest first', {
    group: SORT,
    enumValues: ['desc', 'asc'],
    enumLabels: { desc: 'Newest first', asc: 'Oldest first' },
    defaultValue: 'desc',
    showWhen: SEARCH,
    retainOnHide: true,
  }),
  // --- Authentication ---
  param('username', 'Username', 'string', false, 'Login name', { group: AUTH }),
  param('password', 'Password', 'string', false, 'A secret, masked everywhere', {
    group: AUTH,
    secret: true,
    allowedFormats: ['plain'],
  }),
  param('api_key', 'API Key', 'string', false, 'An API key the cluster issued; a secret', {
    group: AUTH,
    secret: true,
    allowedFormats: ['plain'],
    rowNote: apiKeySchemeNote,
  }),
  param('bearer_token', 'Bearer Token', 'string', false, 'A token such as a JSON Web Token; a secret', {
    group: AUTH,
    secret: true,
    allowedFormats: ['plain'],
    rowNote: bearerSchemeNote,
  }),
  // --- TLS / Certificates: no switch, an https URL uses TLS ---
  ...tlsTrustInputs(TLS_GROUP).map((row) => ({ ...row, rowNote: tlsOnHttpNote })),
  // --- Advanced ---
  param('time_field', 'Time field', 'string', false, 'The date field the window reads', {
    group: ADVANCED,
    defaultValue: '@timestamp',
    fieldSuggest: { source: 'fields', types: 'date' },
  }),
  param('connect_timeout', 'Connect timeout', 'integer', false, 'Seconds to wait for the cluster to accept the connection and finish the TLS handshake', {
    group: ADVANCED,
    defaultValue: 30,
    minimum: 1,
  }),
  // --- Failure Handling ---
  failureHandlingOnErrorInput(),
]

const [SUCCESS, ERROR, REASON] = outputCore({
  successDescription: 'True when the block finished; false when the block failed and On error is Record and continue',
  reasonDescription: 'Unreachable, AuthFailed, RequestFailed, Timeout or Validation; empty when the block passed',
})

export const outputs: OutputParam[] = [
  SUCCESS,
  output('results', 'Results', 'table', 'A table. Search: one row per matching document and one column per entry in Fields. Aggregate: one row per time slot and / or field value, or one row for the whole window, with one column per stat.'),
  output('total_results', 'Total results', 'integer', 'The exact number of matching documents, whatever Max results says.'),
  ERROR,
  REASON,
]

export const secretMaskFields: SecretMaskField[] = [
  { key: 'password', label: 'Password' },
  { key: 'api_key', label: 'API Key' },
  { key: 'bearer_token', label: 'Bearer Token' },
  { key: 'client_key', label: 'Client Key' },
]
