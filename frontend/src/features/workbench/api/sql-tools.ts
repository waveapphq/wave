/**
 * SQL tools API client (REQ-3.4.1.6; SQL-10, SQL-12): the script check and the Get Tables pull.
 */

import { apiClient } from '@/lib/api'
import type { SqlDatabaseType } from '@/lib/codemirror/format-editor'
import type { ElementTypes } from '@/lib/variable-validation'

// ===========================================================================
// Types
// ===========================================================================

export interface SqlCheckRequest {
  database_type: SqlDatabaseType
  script: string
}

/** Line and column are 1-based. */
export interface SqlCheckIssue {
  line: number
  col: number
  message: string
}

export interface SqlCheckResult {
  issues: SqlCheckIssue[]
}

export interface SqlColumn {
  name: string
  type: string
}

export interface SqlTable {
  schema: string
  name: string
  kind: string
  columns: SqlColumn[]
}

/** The 13 connection rows as the block holds them: literals, sealed secrets or expression text; a row it does not hold is left out. */
export interface SqlConnection {
  database_type?: unknown
  host?: unknown
  port?: unknown
  database?: unknown
  username?: unknown
  password?: unknown
  tls?: unknown
  verify_ssl?: unknown
  ca_cert?: unknown
  client_cert?: unknown
  client_key?: unknown
  driver_options?: unknown
  file?: unknown
}

/** Everything the server needs to resolve the rows the way a run of the open test does. */
export interface SqlCatalogRequest {
  connection: SqlConnection
  expression_fields: string[]
  template_fields: string[]
  /** Typed connection settings' element types (Driver options, REQ-3.1.3.19). */
  element_types: Record<string, ElementTypes>
  profile_bindings: { profileId: string; alias: string; profileName: string; profileType: string }[]
  environment_id: string | null
  test_id: string | null
}

export interface SqlCatalogStartRequest extends SqlCatalogRequest {
  refresh?: boolean
}

export interface SqlCatalogStartResult {
  job_id: string
  cached: boolean
  tables?: SqlTable[]
}

export interface SqlCatalogJob {
  status: 'connecting' | 'reading' | 'done' | 'failed' | 'canceled'
  tables?: SqlTable[]
  error?: string
}

// ===========================================================================
// Methods
// ===========================================================================

const NO_ISSUES: SqlCheckResult = { issues: [] }

/** The server parser's findings for a script. A failed request answers none. */
export async function checkSql(
  body: SqlCheckRequest,
  signal?: AbortSignal
): Promise<SqlCheckResult> {
  try {
    const response = await apiClient.post<SqlCheckResult>('/sql-tools/check', body, { signal })
    return response.data
  } catch {
    return NO_ISSUES
  }
}

/** Starts a Get Tables pull, or answers the cached tables of the same resolved connection. */
export async function startCatalog(body: SqlCatalogStartRequest): Promise<SqlCatalogStartResult> {
  const response = await apiClient.post<SqlCatalogStartResult>('/sql-tools/catalog', body)
  return response.data
}

export async function getCatalog(jobId: string): Promise<SqlCatalogJob> {
  const response = await apiClient.get<SqlCatalogJob>(`/sql-tools/catalog/${jobId}`)
  return response.data
}

export async function cancelCatalog(jobId: string): Promise<{ status: 'canceled' }> {
  const response = await apiClient.delete<{ status: 'canceled' }>(`/sql-tools/catalog/${jobId}`)
  return response.data
}
