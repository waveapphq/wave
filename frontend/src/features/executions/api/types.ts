export type ExecutionStatus = 'running' | 'passed' | 'failed' | 'stopped' | 'skipped'
export type ExecutionType = 'test' | 'suite' | 'regression'

export interface Execution {
  id: string
  name: string
  type: ExecutionType
  status: ExecutionStatus
  triggeredBy: string
  startedAt: string
  completedAt?: string | null
  duration: number | null // in seconds
  durationFormatted?: string
  entityId?: string
}

export interface ExecutionApiResponse {
  id: string
  name: string
  type?: string
  entity_type?: string
  entity_id: string
  environment_id?: string
  status: string
  triggered_by: string
  started_at: string
  completed_at: string | null
  duration: number | null
  error_message?: string | null
  selected_tests?: string[] | Array<{ suite_id: string; test_id: string }>
}

export interface ExecutionsApiPagination {
  total: number
  page: number
  per_page: number
  total_pages: number
}

export interface ExecutionsApiResult {
  success: boolean
  data: ExecutionApiResponse[]
  pagination: ExecutionsApiPagination
}

export interface FetchExecutionsParams {
  page?: number
  per_page?: number
  search?: string
  status?: string[]
  type?: string[]
  triggered_by?: string[]
  from_date?: string
  to_date?: string
  sort_by?: string
  sort_order?: 'asc' | 'desc'
}

export interface HistoricalCanvasWorkflow {
  nodes: Array<Record<string, unknown>>
  edges: Array<Record<string, unknown>>
}

export interface HistoricalCanvasLog {
  id?: string
  timestamp?: string
  level?: string
  message?: string
  source?: string
  blockId?: string
  test_id?: string
  run_id?: string
  sequence?: number
}

/**
 * Test variable declaration as the BE returns it (matches the
 * convertBackendVariables shape - keyed by name, with `type`, `value`,
 * optional `isExpression` / `secret`). Used by the Historical Canvas to
 * power the eye-OFF "definition" view of the Variable Manager panel.
 */
export interface HistoricalCanvasVariableDefinition {
  type: string
  value: unknown
  isExpression?: boolean
  secret?: boolean
  scope?: string
}

export interface HistoricalTestCanvasResponse {
  run_id: string
  execution_id: string
  test_id: string | null
  suite_id: string | null
  status: string
  started_at: string | null
  ended_at: string | null
  workflow: HistoricalCanvasWorkflow | null
  block_states: Record<string, string>
  /** End-of-run runtime values (secrets masked). Drives the eye-ON view. */
  variables: Record<string, unknown>
  /** Test definition (declared variables with type / flags). Drives the eye-OFF view. */
  variable_definitions: Record<string, HistoricalCanvasVariableDefinition>
  logs: HistoricalCanvasLog[]
  environment_id: string | null
  environment_name: string | null
}
