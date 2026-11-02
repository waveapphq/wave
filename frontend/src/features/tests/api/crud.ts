/**
 * Tests CRUD API
 *
 * Core CRUD operations for tests: fetch, create, update, delete,
 * clone, and batch operations.
 */

import { apiClient } from '@/lib/api'
import type {
  Test,
  TestStatus,
  TestApiResponse,
  TestsApiResult,
  TestsApiPagination,
  TestDetailApiResponse,
  TestWorkflowApiResponse,
  CreateTestPayload,
  UpdateTestPayload,
  UpdateTestMetadataPayload,
} from './types'

/**
 * Fetch tests from the API with optional filters
 */
export async function fetchTests(params?: {
  page?: number
  per_page?: number
  search?: string
  status?: string[]
  suite_ids?: string[]
  tags?: string[]
  sort_by?: string
  sort_order?: 'asc' | 'desc'
}): Promise<TestsApiResult> {
  const queryParams = new URLSearchParams()
  if (params?.page) queryParams.set('page', params.page.toString())
  if (params?.per_page) queryParams.set('per_page', params.per_page.toString())
  if (params?.search) queryParams.set('search', params.search)
  if (params?.status && params.status.length > 0) queryParams.set('status', params.status.join(','))
  if (params?.suite_ids && params.suite_ids.length > 0) queryParams.set('suite_ids', params.suite_ids.join(','))
  if (params?.tags && params.tags.length > 0) queryParams.set('tags', params.tags.join(','))
  if (params?.sort_by) queryParams.set('sort_by', params.sort_by)
  if (params?.sort_order) queryParams.set('sort_order', params.sort_order)

  const path = `/tests${queryParams.toString() ? '?' + queryParams.toString() : ''}`
  const response = await apiClient.get<TestApiResponse[], TestsApiPagination>(path)

  return {
    success: true,
    data: response.data,
    pagination: response.pagination!,
  }
}


/**
 * Transform API response to Test type for the component
 */
export function transformApiTest(apiTest: TestApiResponse): Test {
  return {
    id: apiTest.id,
    name: apiTest.name,
    suiteCount: apiTest.suite_count ?? 0,
    suiteIds: apiTest.suite_ids ?? [],
    suiteNames: apiTest.suite_names ?? [],
    status: (apiTest.metadata?.status as TestStatus) ?? 'never_run',
    lastRun: apiTest.metadata?.last_run ?? null,
    // Check both top-level and metadata for tags (backend may return in either location)
    tags: apiTest.tags ?? apiTest.metadata?.tags ?? [],
    createdAt: apiTest.created_at ?? null,
    updatedAt: apiTest.updated_at ?? null,
  }
}

/**
 * Delete a test by ID
 */
export async function deleteTest(testId: string): Promise<void> {
  await apiClient.delete(`/tests/${testId}`)
}

/**
 * Clone/duplicate a test
 */
export async function cloneTest(testId: string): Promise<TestApiResponse> {
  const response = await apiClient.post<TestApiResponse>(`/tests/${testId}/clone`)
  return response.data
}

/**
 * Batch delete multiple tests
 */
export async function batchDeleteTests(testIds: string[]): Promise<{ deleted: string[]; failed: string[] }> {
  const response = await apiClient.delete<{ deleted: string[]; failed: string[] }>(
    '/tests/batch',
    { ids: testIds },
    { rawResponse: true }
  )
  return response.data
}

/**
 * Batch update tests (e.g., move to suite)
 */
export async function batchUpdateTests(
  updates: Array<{ id: string; metadata?: Record<string, unknown> }>
): Promise<{ updated: string[]; failed: string[] }> {
  const response = await apiClient.patch<{ updated: string[]; failed: string[] }>('/tests/batch', updates)
  return response.data
}

/**
 * Create a new test
 */
export async function createTest(payload: CreateTestPayload): Promise<TestApiResponse> {
  const response = await apiClient.post<TestApiResponse>('/tests', payload)
  return response.data
}

/**
 * Update an existing test
 */
export async function updateTest(testId: string, payload: UpdateTestPayload): Promise<TestApiResponse> {
  const response = await apiClient.put<TestApiResponse>(`/tests/${testId}`, payload)
  return response.data
}

/**
 * Update only test metadata (name, description, tags, suite)
 * Does not update the workflow - useful for editing test info while keeping workflow changes dirty
 */
export async function updateTestMetadata(testId: string, payload: UpdateTestMetadataPayload): Promise<TestApiResponse> {
  const response = await apiClient.patch<TestApiResponse>(`/tests/${testId}/metadata`, payload)
  return response.data
}

/**
 * Fetch a single test by ID
 */
export async function fetchTest(testId: string): Promise<TestDetailApiResponse> {
  const response = await apiClient.get<TestDetailApiResponse>(`/tests/${testId}`)
  return response.data
}

/**
 * Fetch test workflow (nodes and edges) for canvas loading
 */
export async function fetchTestWorkflow(testId: string): Promise<TestWorkflowApiResponse> {
  const response = await apiClient.get<TestWorkflowApiResponse>(`/tests/${testId}/workflow`)
  return response.data
}

/**
 * Fetch all unique tags from all tests
 * REQ-9.5.3.1: GET /tests/tags
 */
export async function fetchTestsTags(): Promise<string[]> {
  const response = await apiClient.get<string[]>('/tests/tags')
  return response.data
}
