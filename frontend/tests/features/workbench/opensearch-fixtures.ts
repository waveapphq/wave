/**
 * Shared OpenSearch block fixtures: pulled fields and indexes, a connection, a Get fields request and query texts.
 *
 * REQ-3.4.1.15: OpenSearch search and aggregation
 */

import type {
  OpenSearchConnection,
  OpenSearchField,
  OpenSearchFieldsRequest,
  OpenSearchIndex,
} from '@/features/workbench/api/opensearch-tools'

/** Field order, as the server answers it. */
export const SAMPLE_FIELDS: readonly OpenSearchField[] = [
  { name: '@timestamp', types: ['date'], aggregatable: true },
  { name: 'log.level', types: ['keyword'], aggregatable: true },
  { name: 'message', types: ['text'], aggregatable: false },
  { name: 'service.name', types: ['keyword'], aggregatable: true },
  { name: 'service.version', types: ['keyword'], aggregatable: true },
  { name: 'trace.id', types: ['keyword'], aggregatable: true },
  { name: 'host.name', types: ['keyword'], aggregatable: true },
  { name: 'latency_ms', types: ['long'], aggregatable: true },
  { name: 'requests_total', types: ['double'], aggregatable: true },
  { name: 'user.id', types: ['keyword'], aggregatable: true },
  // Mapped differently across the folded indexes.
  { name: 'status', types: ['keyword', 'long'], aggregatable: true },
]

export const SAMPLE_INDEXES: readonly OpenSearchIndex[] = [
  { name: 'filebeat-*', kind: 'folded', count: 30 },
  { name: 'app-logs', kind: 'index', count: 1 },
  { name: 'logs-current', kind: 'alias', count: 1 },
  { name: 'metrics-app', kind: 'data_stream', count: 1 },
]

/** The eleven connection rows of a block with a literal URL and Basic auth. */
export const SAMPLE_OS_CONNECTION: OpenSearchConnection = {
  url: 'https://opensearch.example:9200',
  username: 'wave',
  password: 'os-secret',
  verify_ssl: true,
  ca_cert: null,
  client_cert: null,
  index: 'filebeat-*',
  connect_timeout: null,
}

/** The Get fields request of that block: literal rows, no profile, no Environment, no saved test. */
export const SAMPLE_FIELDS_REQUEST: OpenSearchFieldsRequest = {
  connection: SAMPLE_OS_CONNECTION,
  expression_fields: [],
  template_fields: [],
  element_types: {},
  profile_bindings: [],
  environment_id: null,
  test_id: null,
}

export const SAMPLE_DQL = 'log.level: ERROR and service.name: "checkout"'

export const SAMPLE_QUERY_DSL = JSON.stringify(
  { bool: { filter: [{ term: { 'log.level': 'ERROR' } }] } },
  null,
  2
)

export const SAMPLE_AGGREGATION_JSON = JSON.stringify(
  { percentiles: { field: 'latency_ms', percents: [99] } },
  null,
  2
)
