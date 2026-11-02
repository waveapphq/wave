/**
 * Suites API Client
 *
 * Fetches suite data from the backend API and transforms it
 * for the SuitesPage component.
 */

import { apiClient } from '@/lib/api'
import type {
  SuiteApiResponse,
  SuitesApiResult,
  SuiteListApiResponse,
  SuitesListApiPagination,
  SuitesListApiResult,
  SuiteListItem,
  SuiteDetailApiResponse,
  SuiteDetail,
  SuiteTestApiResponse,
  SuiteTestEntry,
  CreateSuitePayload,
  UpdateSuitePayload,
  TestInfo,
  SuiteName,
} from './types'

// ===========================================================================
// Helper Functions
// ===========================================================================

// ===========================================================================
// API Functions
// ===========================================================================

/**
 * Fetch suites from the API (simple version for filters dropdown)
 */
export async function fetchSuites(): Promise<SuitesApiResult> {
  const response = await apiClient.get<SuiteApiResponse[]>('/suites')
  return {
    success: true,
    data: response.data,
  }
}

/**
 * Fetch suites list with pagination, filtering, and sorting
 * Used by the Suites List page
 */
export async function fetchSuitesList(params?: {
  page?: number
  per_page?: number
  search?: string
  status?: string[]
  tags?: string[]
  sort_by?: string
  sort_order?: 'asc' | 'desc'
}): Promise<SuitesListApiResult> {
  const queryParams = new URLSearchParams()
  if (params?.page) queryParams.set('page', params.page.toString())
  if (params?.per_page) queryParams.set('per_page', params.per_page.toString())
  if (params?.search) queryParams.set('search', params.search)
  if (params?.status && params.status.length > 0) queryParams.set('status', params.status.join(','))
  if (params?.tags && params.tags.length > 0) queryParams.set('tags', params.tags.join(','))
  if (params?.sort_by) queryParams.set('sort_by', params.sort_by)
  if (params?.sort_order) queryParams.set('sort_order', params.sort_order)

  const path = `/suites${queryParams.toString() ? '?' + queryParams.toString() : ''}`
  const response = await apiClient.get<SuiteListApiResponse[], SuitesListApiPagination>(path)
  return {
    success: true,
    data: response.data,
    pagination: response.pagination!,
  }
}

/**
 * Delete a suite by ID
 */
export async function deleteSuite(suiteId: string): Promise<void> {
  await apiClient.delete(`/suites/${suiteId}`)
}

/**
 * Clone/duplicate a suite
 */
export async function cloneSuite(suiteId: string, suiteName?: string): Promise<SuiteListApiResponse> {
  // Generate a new name for the cloned suite
  const newName = suiteName ? `${suiteName} (Copy)` : `Suite (Copy) ${Date.now()}`
  const response = await apiClient.post<SuiteListApiResponse>(`/suites/${suiteId}/clone`, { new_name: newName })
  return response.data
}

/**
 * Batch clone multiple suites
 */
export async function batchCloneSuites(suiteIds: string[]): Promise<{ cloned: Array<{ original_id: string; cloned_id: string }>; failed: Array<{ index: number; error: string }> }> {
  const response = await apiClient.post<{ cloned: Array<{ original_id: string; cloned_id: string }>; failed: Array<{ index: number; error: string }> }>(
    '/suites/batch/clone',
    suiteIds,
    { rawResponse: true }
  )
  return response.data
}

/**
 * Batch delete multiple suites
 */
export async function batchDeleteSuites(suiteIds: string[]): Promise<{ deleted: string[]; failed: Array<{ index: number; error: string }> }> {
  // Backend expects a plain array, not { ids: [...] }
  const response = await apiClient.delete<{ deleted: string[]; failed: Array<{ index: number; error: string }> }>(
    '/suites/batch',
    suiteIds,
    { rawResponse: true }
  )
  return response.data
}

/**
 * Fetch tests for a suite (for run dialog)
 */
export async function fetchSuiteTests(suiteId: string): Promise<TestInfo[]> {
  const response = await apiClient.get<TestInfo[]>(`/suites/${suiteId}/tests`)
  return response.data
}

// ===========================================================================
// Transform Functions
// ===========================================================================

/**
 * Transform API suite response to Suite type (simple, for filters dropdown)
 */
export function transformApiSuite(apiSuite: SuiteApiResponse): SuiteName {
  return {
    id: apiSuite.id,
    name: apiSuite.name,
  }
}

/**
 * Transform API suite list response to SuiteListItem type
 * Used by the Suites List page
 */
export function transformApiSuiteList(apiSuite: SuiteListApiResponse): SuiteListItem {
  return {
    id: apiSuite.id,
    name: apiSuite.name,
    description: apiSuite.description ?? null,
    testsCount: apiSuite.tests_count,
    status: apiSuite.status,
    lastRun: apiSuite.last_run ?? null,
    tags: apiSuite.tags ?? [],
    createdAt: apiSuite.created_at ?? null,
    updatedAt: apiSuite.updated_at ?? null,
  }
}

// ===========================================================================
// Tags API (REQ-9.5.3.2)
// ===========================================================================

/**
 * Fetch all unique tags from all suites
 * REQ-9.5.3.2: GET /suites/tags
 */
export async function fetchSuitesTags(): Promise<string[]> {
  const response = await apiClient.get<string[]>('/suites/tags')
  return response.data
}

// ===========================================================================
// Suite Names API (REQ-9.5.3.5)
// ===========================================================================

/**
 * Fetch all suites with minimal data for dropdowns
 * REQ-9.5.3.5: GET /suites/names
 */
export async function fetchSuiteNames(): Promise<SuiteName[]> {
  const response = await apiClient.get<SuiteName[]>('/suites/names')
  return response.data
}

// ===========================================================================
// Suite Detail API
// ===========================================================================

/**
 * Transform API suite detail response to frontend SuiteDetail type
 */
export function transformSuiteDetail(apiSuite: SuiteDetailApiResponse): SuiteDetail {
  return {
    id: apiSuite.id,
    name: apiSuite.name,
    description: apiSuite.description,
    version: apiSuite.version,
    createdAt: apiSuite.created_at,
    updatedAt: apiSuite.updated_at,
    testIds: apiSuite.tests ?? [],
    testsCount: apiSuite.tests_count,
    status: apiSuite.status,
    lastRun: apiSuite.last_run ?? null,
    tags: apiSuite.tags ?? [],
    variables: apiSuite.variables ?? {},
  }
}

/**
 * Create a new suite
 */
export async function createSuite(payload: CreateSuitePayload): Promise<SuiteDetail> {
  const response = await apiClient.post<SuiteDetailApiResponse>('/suites', payload)
  return transformSuiteDetail(response.data)
}

/**
 * Transform API suite test response to frontend SuiteTestEntry
 */
/* v8 ignore start - COV-V8-003: V8 tracks ?? branches */
export function transformSuiteTest(apiTest: SuiteTestApiResponse): SuiteTestEntry {
  return {
    id: apiTest.id,
    name: apiTest.name,
    status: apiTest.metadata?.status ?? 'never_run',
    lastRun: apiTest.metadata?.last_run ?? null,
    tags: apiTest.tags ?? [],
    createdAt: apiTest.created_at ?? null,
    updatedAt: apiTest.updated_at ?? null,
  }
}
/* v8 ignore stop */

/**
 * Fetch full suite detail (metadata + tests) via Promise.all
 */
export async function fetchSuiteDetail(
  suiteId: string
): Promise<{ suite: SuiteDetail; tests: SuiteTestEntry[] }> {
  const [suiteResponse, testsResponse] = await Promise.all([
    apiClient.get<SuiteDetailApiResponse>(`/suites/${suiteId}`),
    apiClient.get<SuiteTestApiResponse[]>(`/suites/${suiteId}/tests`),
  ])
  return {
    suite: transformSuiteDetail(suiteResponse.data),
    tests: testsResponse.data.map(transformSuiteTest),
  }
}

/**
 * Update an existing suite
 */
export async function updateSuite(
  suiteId: string,
  payload: UpdateSuitePayload
): Promise<SuiteDetail> {
  const response = await apiClient.put<SuiteDetailApiResponse>(`/suites/${suiteId}`, payload)
  return transformSuiteDetail(response.data)
}

// ===========================================================================
// Suite Composition API (test membership)
// ===========================================================================

/**
 * Add a test to a suite via composition endpoint
 */
export async function addTestToSuite(suiteId: string, testId: string): Promise<void> {
  await apiClient.post(`/suites/${suiteId}/tests`, { test_id: testId })
}

/**
 * Remove a test from a suite via composition endpoint
 */
export async function removeTestFromSuite(suiteId: string, testId: string): Promise<void> {
  await apiClient.delete(`/suites/${suiteId}/tests/${testId}`)
}

/**
 * Fetch variables for a specific suite (for workbench autocomplete)
 */
export async function fetchSuiteVariables(
  suiteId: string
): Promise<Record<string, { type: string; value: unknown; secret?: boolean }>> {
  const response = await apiClient.get<Record<string, { type: string; value: unknown; secret?: boolean }>>(
    `/suites/${suiteId}/variables`
  )
  return response.data
}
