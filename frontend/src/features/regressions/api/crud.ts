/**
 * Regression API Client
 *
 * List + detail-level operations for regressions: list, fetch, create,
 * update, delete, clone, tags, suites-with-tests.
 */

import { apiClient } from '@/lib/api'
import { toSnakeCase } from '@/lib/string-case'
import type {
  RegressionApiResponse,
  RegressionsApiPagination,
  Regression,
  FetchRegressionsResult,
  RegressionApiResult,
  SuiteWithTests,
  RegressionDetailApiResponse,
  RegressionDetail,
  RegressionSuiteApiResponse,
  RegressionSuiteEntry,
  UpdateRegressionPayload,
} from './types'

function transformRegressionDetail(
  api: RegressionDetailApiResponse,
): RegressionDetail {
  return {
    id: api.id,
    name: api.name,
    description: api.description,
    createdAt: api.created_at,
    updatedAt: api.updated_at,
    suiteIds: api.suites ?? [],
    suitesCount: api.suites_count,
    testsCount: api.tests_count,
    status: api.status,
    lastRun: api.last_run ?? null,
    tags: api.tags ?? [],
    variables: api.variables ?? {},
  }
}

function transformRegressionSuite(
  api: RegressionSuiteApiResponse,
): RegressionSuiteEntry {
  return {
    id: api.id,
    name: api.name,
    description: api.description,
    status: api.status,
    lastRun: api.last_run ?? null,
    /* v8 ignore next - COV-V8-003: V8 tracks defensive nullish coalescing for a typed non-null field as branch */
    tags: api.tags ?? [],
    testsCount: api.tests_count,
    avgDuration: api.avg_duration ?? null,
    createdAt: api.created_at,
    updatedAt: api.updated_at,
  }
}

/**
 * Fetch full regression detail (metadata + suites) via Promise.all
 */
export async function fetchRegressionDetail(
  regressionId: string,
): Promise<{ regression: RegressionDetail; suites: RegressionSuiteEntry[] }> {
  const [regressionResponse, suitesResponse] = await Promise.all([
    apiClient.get<RegressionDetailApiResponse>(
      `/regressions/${regressionId}`,
    ),
    apiClient.get<RegressionSuiteApiResponse[]>(
      `/regressions/${regressionId}/suites`,
    ),
  ])
  return {
    regression: transformRegressionDetail(regressionResponse.data),
    suites: suitesResponse.data.map(transformRegressionSuite),
  }
}

/**
 * Create a new regression
 */
export async function createRegression(payload: {
  name: string
  description?: string
  tags?: string[]
}): Promise<RegressionDetail> {
  const response = await apiClient.post<RegressionDetailApiResponse>(
    '/regressions',
    payload,
  )
  return transformRegressionDetail(response.data)
}

/**
 * Update an existing regression
 */
export async function updateRegression(
  regressionId: string,
  payload: UpdateRegressionPayload,
): Promise<RegressionDetail> {
  const response = await apiClient.put<RegressionDetailApiResponse>(
    `/regressions/${regressionId}`,
    payload,
  )
  return transformRegressionDetail(response.data)
}

/**
 * Delete an existing regression.
 */
export async function deleteRegression(regressionId: string): Promise<void> {
  await apiClient.delete(`/regressions/${regressionId}`)
}

/**
 * Fetch all unique tags from all regressions
 */
export async function fetchRegressionsTags(): Promise<string[]> {
  const response = await apiClient.get<string[]>('/regressions/tags')
  return response.data
}

// ---------------------------------------------------------------------------
// List-level operations (moved from api/regressions.ts)
// ---------------------------------------------------------------------------

/**
 * Fetch regressions list from the API with optional filters.
 */
export async function fetchRegressions(params?: {
  page?: number
  per_page?: number
  search?: string
  status?: string[]
  tags?: string[]
  sort_by?: string
  sort_order?: 'asc' | 'desc'
}): Promise<FetchRegressionsResult> {
  const queryParams = new URLSearchParams()
  if (params?.page) queryParams.set('page', params.page.toString())
  if (params?.per_page) queryParams.set('per_page', params.per_page.toString())
  if (params?.search) queryParams.set('search', params.search)
  if (params?.status && params.status.length > 0) queryParams.set('status', params.status.join(','))
  if (params?.tags && params.tags.length > 0) queryParams.set('tags', params.tags.join(','))
  if (params?.sort_by) queryParams.set('sort_by', toSnakeCase(params.sort_by))
  if (params?.sort_order) queryParams.set('sort_order', params.sort_order)

  const path = `/regressions${queryParams.toString() ? '?' + queryParams.toString() : ''}`
  const response = await apiClient.get<RegressionApiResponse[], RegressionsApiPagination>(path)
  return {
    success: true,
    data: response.data.map(transformApiRegression),
    pagination: response.pagination!,
  }
}

/**
 * Fetch a single regression list entry by ID.
 */
export async function fetchRegression(regressionId: string): Promise<RegressionApiResult> {
  const response = await apiClient.get<RegressionApiResponse>(`/regressions/${regressionId}`)
  return {
    success: true,
    data: response.data,
  }
}

/**
 * Batch delete regressions.
 */
export async function batchDeleteRegressions(regressionIds: string[]): Promise<{ deleted: string[]; failed: Array<{ index: number; error: string }> }> {
  const response = await apiClient.delete<{ deleted: string[]; failed: Array<{ index: number; error: string }> }>(
    '/regressions/batch',
    regressionIds,
    { rawResponse: true },
  )
  return response.data
}

/**
 * Batch clone multiple regressions.
 */
export async function batchCloneRegressions(regressionIds: string[]): Promise<{ cloned: Array<{ original_id: string; cloned_id: string }>; failed: Array<{ index: number; error: string }> }> {
  const response = await apiClient.post<{ cloned: Array<{ original_id: string; cloned_id: string }>; failed: Array<{ index: number; error: string }> }>(
    '/regressions/batch/clone',
    regressionIds,
    { rawResponse: true },
  )
  return response.data
}

/**
 * Clone/duplicate a regression.
 */
export async function cloneRegression(regressionId: string, regressionName?: string): Promise<Regression> {
  const newName = regressionName ? `${regressionName} (Copy)` : `Regression (Copy) ${Date.now()}`
  const response = await apiClient.post<RegressionApiResponse>(`/regressions/${regressionId}/clone`, { name: newName })
  return transformApiRegression(response.data)
}

/**
 * Transform list-API response to the `Regression` list-row type.
 */
export function transformApiRegression(apiRegression: RegressionApiResponse): Regression {
  return {
    id: apiRegression.id,
    name: apiRegression.name,
    version: apiRegression.version,
    description: apiRegression.description ?? null,
    suitesCount: apiRegression.suites_count,
    testsCount: apiRegression.tests_count,
    status: apiRegression.status,
    /* v8 ignore next - COV-V8-003: V8 tracks nullish coalescing as branch */
    lastRun: apiRegression.last_run ?? null,
    /* v8 ignore next - COV-V8-003: V8 tracks nullish coalescing as branch */
    tags: apiRegression.tags ?? [],
    createdAt: apiRegression.created_at,
    updatedAt: apiRegression.updated_at,
  }
}

/**
 * Fetch suites with their tests for a regression (used by the run dialog).
 */
export async function fetchRegressionSuitesWithTests(regressionId: string): Promise<SuiteWithTests[]> {
  const response = await apiClient.get<SuiteWithTests[]>(`/regressions/${regressionId}/suites`)
  return response.data
}
