/**
 * OpenSearch tools API client (REQ-3.3.2.6, REQ-5.1.2; OS-12, OS-13): the query check, the suggestions and the
 * Get fields pull.
 */

import { apiClient } from '@/lib/api'
import type { ElementTypes } from '@/lib/variable-validation'

// ===========================================================================
// Types
// ===========================================================================

export type OpenSearchLanguage = 'dql' | 'query_dsl' | 'aggregation'

export interface OpenSearchCheckRequest {
  language: OpenSearchLanguage
  text: string
  /** Template kind: the {{ }} regions are WAVE expressions, not query text. */
  template: boolean
  fields_job_id: string | null
  index: string
}

/** Line and column are 1-based; column and length count characters. */
export interface OpenSearchCheckIssue {
  line: number
  col: number
  length: number
  message: string
}

export interface OpenSearchCheckResult {
  issues: OpenSearchCheckIssue[]
}

export interface OpenSearchSuggestRequest {
  language: OpenSearchLanguage
  text: string
  /** Cursor offset in characters. */
  cursor: number
  template: boolean
  fields_job_id: string | null
}

export interface OpenSearchSuggestion {
  label: string
  kind: 'field' | 'operator' | 'key' | 'value'
  detail: string
  info: string
}

/** The span the items replace, in characters. */
export interface OpenSearchSuggestions {
  from: number
  to: number
  items: OpenSearchSuggestion[]
}

export interface OpenSearchIndex {
  name: string
  kind: 'index' | 'alias' | 'data_stream' | 'folded'
  count: number
}

export interface OpenSearchField {
  name: string
  types: string[]
  aggregatable: boolean
}

/** The eleven connection rows as the block holds them: literals, sealed secrets or expression text; a row it does not hold is left out. */
export interface OpenSearchConnection {
  url?: unknown
  username?: unknown
  password?: unknown
  api_key?: unknown
  bearer_token?: unknown
  verify_ssl?: unknown
  ca_cert?: unknown
  client_cert?: unknown
  client_key?: unknown
  index?: unknown
  connect_timeout?: unknown
}

/** Everything the server needs to resolve the rows the way a run of the open test does. */
export interface OpenSearchFieldsRequest {
  connection: OpenSearchConnection
  expression_fields: string[]
  template_fields: string[]
  element_types: Record<string, ElementTypes>
  profile_bindings: { profileId: string; alias: string; profileName: string; profileType: string }[]
  environment_id: string | null
  test_id: string | null
}

export interface OpenSearchFieldsStartRequest extends OpenSearchFieldsRequest {
  refresh?: boolean
}

export interface OpenSearchFieldsStartResult {
  job_id: string
  cached: boolean
  indexes?: OpenSearchIndex[]
  fields?: OpenSearchField[]
}

export interface OpenSearchFieldsJob {
  status: 'connecting' | 'reading' | 'done' | 'failed' | 'canceled'
  indexes?: OpenSearchIndex[]
  fields?: OpenSearchField[]
  error?: string
}

// ===========================================================================
// Methods
// ===========================================================================

const NO_ISSUES: OpenSearchCheckResult = { issues: [] }

/** The server's findings for a query body. A failed request answers none. */
export async function checkOpenSearch(
  body: OpenSearchCheckRequest,
  signal?: AbortSignal,
): Promise<OpenSearchCheckResult> {
  try {
    const response = await apiClient.post<OpenSearchCheckResult>('/opensearch-tools/check', body, { signal })
    return response.data
  } catch {
    return NO_ISSUES
  }
}

/** The suggestions at the cursor. A failed request answers none, at the cursor. */
export async function suggestOpenSearch(
  body: OpenSearchSuggestRequest,
  signal?: AbortSignal,
): Promise<OpenSearchSuggestions> {
  try {
    const response = await apiClient.post<OpenSearchSuggestions>('/opensearch-tools/suggest', body, { signal })
    return response.data
  } catch {
    return { from: body.cursor, to: body.cursor, items: [] }
  }
}

/** Starts a Get fields pull, or answers the cached lists of the same resolved connection. */
export async function startFields(body: OpenSearchFieldsStartRequest): Promise<OpenSearchFieldsStartResult> {
  const response = await apiClient.post<OpenSearchFieldsStartResult>('/opensearch-tools/fields', body)
  return response.data
}

export async function getFields(jobId: string): Promise<OpenSearchFieldsJob> {
  const response = await apiClient.get<OpenSearchFieldsJob>(`/opensearch-tools/fields/${jobId}`)
  return response.data
}

export async function cancelFields(jobId: string): Promise<{ status: 'canceled' }> {
  const response = await apiClient.delete<{ status: 'canceled' }>(`/opensearch-tools/fields/${jobId}`)
  return response.data
}
