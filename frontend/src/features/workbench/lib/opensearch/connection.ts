/**
 * The Get fields request of an OpenSearch block and its connection rows (REQ-3.3.2.5; OS-13).
 */

import type {
  OpenSearchConnection,
  OpenSearchFieldsRequest,
} from '@/features/workbench/api/opensearch-tools'
import { catalogRequestOf, type CatalogRequestInput } from '@/features/workbench/lib/catalog-request'

const CONNECTION_ROWS: ReadonlySet<string> = new Set([
  'url',
  'username',
  'password',
  'api_key',
  'bearer_token',
  'verify_ssl',
  'ca_cert',
  'client_cert',
  'client_key',
  'index',
  'connect_timeout',
])

/** No connection row holds typed values, so the request carries no element types. */
export type OpenSearchFieldsRequestInput = Omit<CatalogRequestInput, 'elementTypes'>

/** The connection rows of an OpenSearch block's values as the block holds them; the server fills every default (REQ-3.3.2.5). */
export function openSearchConnectionOf(values: Record<string, unknown>): OpenSearchConnection {
  return {
    url: values.url,
    username: values.username,
    // A credential row goes as it sits: absent is nothing given, a held null is refused (REQ-3.1.3.21).
    password: values.password,
    api_key: values.api_key,
    bearer_token: values.bearer_token,
    verify_ssl: values.verify_ssl,
    ca_cert: values.ca_cert,
    client_cert: values.client_cert,
    client_key: values.client_key,
    index: values.index,
    connect_timeout: values.connect_timeout,
  }
}

/** The whole Get fields request of a block: its rows plus what the server resolves them with. */
export function openSearchFieldsRequestOf(input: OpenSearchFieldsRequestInput): OpenSearchFieldsRequest {
  return catalogRequestOf(input, CONNECTION_ROWS, openSearchConnectionOf)
}

/** What every fields surface says while the Index pattern is blank. */
export const FILL_IN_INDEX_PATTERN = 'Fill in Index pattern to get fields'

/** Index pattern is empty or only spaces as written; an expression or a template is never blank. */
export function indexPatternIsBlank(request: OpenSearchFieldsRequest): boolean {
  if (request.expression_fields.includes('index') || request.template_fields.includes('index')) return false
  const { index } = request.connection
  return index === undefined || index === null || (typeof index === 'string' && index.trim() === '')
}
