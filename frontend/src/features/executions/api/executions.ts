/**
 * Executions API Client
 *
 * REQ-5.2.1.40: Execution history screen
 *
 * Fetches execution data from the backend API and transforms it
 * for the ExecutionsPage component.
 */

import type {
  Execution,
  ExecutionStatus,
  ExecutionType,
  ExecutionApiResponse,
  ExecutionsApiPagination,
  ExecutionsApiResult,
  FetchExecutionsParams,
  HistoricalTestCanvasResponse,
} from './types'
import { apiClient } from '@/lib/api'
import { toSnakeCase } from '@/lib/string-case'
import { formatDuration } from '@/lib/format-duration'

/**
 * Fetch executions from the API with optional filters
 */
export async function fetchExecutions(params?: FetchExecutionsParams): Promise<ExecutionsApiResult> {
  const queryParams = new URLSearchParams()
  if (params?.page) queryParams.set('page', params.page.toString())
  if (params?.per_page) queryParams.set('per_page', params.per_page.toString())
  if (params?.search) queryParams.set('search', params.search)
  if (params?.status && params.status.length > 0) queryParams.set('status', params.status.join(','))
  if (params?.type && params.type.length > 0) queryParams.set('type', params.type.join(','))
  if (params?.triggered_by && params.triggered_by.length > 0) queryParams.set('triggered_by', params.triggered_by.join(','))
  if (params?.from_date) queryParams.set('from_date', params.from_date)
  if (params?.to_date) queryParams.set('to_date', params.to_date)
  // Executions endpoint uses 'sort' and 'order' params (not sort_by/sort_order)
  // Convert camelCase to snake_case for backend (e.g., startedAt -> started_at)
  if (params?.sort_by) queryParams.set('sort', toSnakeCase(params.sort_by))
  if (params?.sort_order) queryParams.set('order', params.sort_order)

  const path = `/executions${queryParams.toString() ? '?' + queryParams.toString() : ''}`
  const response = await apiClient.get<ExecutionApiResponse[], ExecutionsApiPagination>(path)
  return { success: true, data: response.data, pagination: response.pagination! }
}

/**
 * Fetch unique triggered_by values for the User filter
 */
export async function fetchExecutionUsers(): Promise<string[]> {
  const response = await apiClient.get<string[]>('/executions/users')
  return response.data
}

/**
 * Fetch a single execution by ID
 */
export async function fetchExecution(executionId: string): Promise<{ success: boolean; data: ExecutionApiResponse }> {
  const response = await apiClient.get<ExecutionApiResponse>(`/executions/${executionId}`)
  return { success: true, data: response.data }
}

/**
 * Fetch the Historical Test Canvas payload for a specific test run.
 * Returns the painted-snapshot data (workflow, per-block states,
 * variables masked, per-run logs slice, timings / status) the
 * `/executions/history/:runId` page needs to render. The `run_id` is
 * opaque and unique per test run - for a regression where the same
 * test_id appears in two suites, each suite's run has its own run_id
 * and therefore its own history page.
 */
export async function getHistoricalTestRun(
  runId: string,
): Promise<HistoricalTestCanvasResponse> {
  const response = await apiClient.get<HistoricalTestCanvasResponse>(
    `/executions/history/${runId}`,
  )
  return response.data
}

/**
 * Stop a running execution.
 *
 * Accepts an optional mode: 'immediate' (default) stops at the next safe
 * point without running finalizers; 'finalize' lets any running finalizers
 * complete before stopping.
 */
export async function stopExecution(
  executionId: string,
  options: { mode?: 'immediate' | 'finalize' } = {},
): Promise<void> {
  const query = options.mode ? `?mode=${options.mode}` : ''
  await apiClient.put(`/executions/${executionId}/stop${query}`)
}

/**
 * Delete an execution permanently
 *
 * Only terminal executions (passed, failed, stopped) can be deleted.
 * Running or paused executions must be stopped first.
 */
export async function deleteExecution(executionId: string): Promise<void> {
  await apiClient.delete(`/executions/${executionId}`)
}

/**
 * Start a new execution
 *
 * Creates a new execution for the specified entity (test, suite, or regression)
 * in the specified environment. When `selectedTests` is supplied, the backend
 * scopes the run to the subset:
 * - For a suite: an array of test IDs.
 * - For a regression: an array of `{ suiteId, testId }` pairs so the same
 *   test id appearing in multiple suites of the regression can be selected
 *   independently per suite context.
 * Tests are atomic, so `selectedTests` is not valid for test-type runs.
 */
export interface StartExecutionPair {
  suiteId: string
  testId: string
}

export async function startExecution(params: {
  type: string
  id: string
  environmentId: string
  selectedTests?: string[] | StartExecutionPair[]
}): Promise<{ id: string }> {
  const body: Record<string, unknown> = {
    type: params.type,
    id: params.id,
    environment_id: params.environmentId,
  }
  if (params.selectedTests !== undefined) {
    body.selected_tests = serializeSelectedTests(params.selectedTests)
  }
  const response = await apiClient.post<{ id: string }>('/executions', body)
  return { id: response.data.id }
}

function serializeSelectedTests(
  selected: string[] | StartExecutionPair[]
): string[] | Array<{ suite_id: string; test_id: string }> {
  /* v8 ignore next - COV-BRANCH-029: defensive empty-array guard */
  if (selected.length === 0) return []
  const first = selected[0]
  if (typeof first === 'string') {
    return selected as string[]
  }
  return (selected as StartExecutionPair[]).map((p) => ({
    suite_id: p.suiteId,
    test_id: p.testId,
  }))
}

/**
 * Map API status to frontend ExecutionStatus type
 */
function mapStatus(apiStatus: string): ExecutionStatus {
  switch (apiStatus.toLowerCase()) {
    case 'running':
      return 'running'
    case 'passed':
      return 'passed'
    case 'failed':
      return 'failed'
    case 'stopped':
      return 'stopped'
    case 'skipped':
      return 'skipped'
    default:
      // Unknown status: surface it as the server's value rather than
      // silently claiming the run is still running. The list used to
      // fall back to 'running' here, which is why a regression-halted
      // run (status='skipped') showed up in the list as Running even
      // after the backend had settled it as skipped.
      return apiStatus.toLowerCase() as ExecutionStatus
  }
}

/**
 * Map API type to frontend ExecutionType type
 */
function mapType(typeValue: string): ExecutionType {
  switch (typeValue.toLowerCase()) {
    case 'test':
      return 'test'
    case 'suite':
      return 'suite'
    case 'regression':
      return 'regression'
    default:
      return 'test'
  }
}


/**
 * Transform API response to Execution type for the component
 */
export function transformApiExecution(apiExecution: ExecutionApiResponse): Execution {
  // Backend uses entity_type, but tests may use type - handle both
  const typeValue = apiExecution.type ?? apiExecution.entity_type ?? 'test'

  return {
    id: apiExecution.id,
    name: apiExecution.name,
    type: mapType(typeValue),
    status: mapStatus(apiExecution.status),
    triggeredBy: apiExecution.triggered_by,
    startedAt: apiExecution.started_at,
    completedAt: apiExecution.completed_at,
    duration: apiExecution.duration,
    durationFormatted: formatDuration(apiExecution.duration),
    entityId: apiExecution.entity_id,
  }
}
