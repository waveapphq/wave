/**
 * Environments CRUD API
 *
 * REQ-5.2.1.42: Settings and preferences screen - Environments management
 *
 * CRUD operations and helper functions for environment data.
 */

import { apiClient } from '@/lib/api'
import type {
  Environment,
  EnvironmentApiResponse,
  EnvironmentsApiPagination,
  EnvironmentsListResult,
  CreateEnvironmentRequest,
  UpdateEnvironmentRequest,
  EnvironmentName,
} from './types'

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Transform API environment response to frontend model
 */
export function transformApiEnvironment(apiEnv: EnvironmentApiResponse): Environment {
  return {
    id: apiEnv.id,
    name: apiEnv.name,
    description: apiEnv.description ?? null,
    tags: apiEnv.tags ?? [],
    usage: apiEnv.usage,
    createdAt: apiEnv.created_at,
    updatedAt: apiEnv.updated_at,
  }
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * Fetch environments list with optional filters
 */
export async function fetchEnvironments(params?: {
  page?: number
  per_page?: number
  search?: string
  tags?: string[]
  sort_by?: string
  sort_direction?: 'asc' | 'desc'
}): Promise<EnvironmentsListResult> {
  const queryParams = new URLSearchParams()

  if (params?.page) queryParams.set('page', params.page.toString())
  if (params?.per_page) queryParams.set('per_page', params.per_page.toString())
  if (params?.search) queryParams.set('search', params.search)
  if (params?.tags && params.tags.length > 0) queryParams.set('tags', params.tags.join(','))
  if (params?.sort_by) queryParams.set('sort_by', params.sort_by)
  if (params?.sort_direction) queryParams.set('sort_direction', params.sort_direction)

  const path = `/environments${queryParams.toString() ? '?' + queryParams.toString() : ''}`

  const response = await apiClient.get<EnvironmentApiResponse[], EnvironmentsApiPagination>(path)

  return {
    data: response.data.map(transformApiEnvironment),
    pagination: response.pagination!,
  }
}

/**
 * Fetch single environment by ID
 */
export async function fetchEnvironment(id: string): Promise<Environment> {
  const response = await apiClient.get<EnvironmentApiResponse>(`/environments/${id}`)
  return transformApiEnvironment(response.data)
}

/**
 * Create a new environment
 */
export async function createEnvironment(
  request: CreateEnvironmentRequest
): Promise<Environment> {
  const response = await apiClient.post<EnvironmentApiResponse>('/environments', request)
  return transformApiEnvironment(response.data)
}

/**
 * Update an existing environment
 */
export async function updateEnvironment(
  id: string,
  request: UpdateEnvironmentRequest
): Promise<Environment> {
  const response = await apiClient.put<EnvironmentApiResponse>(`/environments/${id}`, request)
  return transformApiEnvironment(response.data)
}

/**
 * Delete an environment
 */
export async function deleteEnvironment(id: string): Promise<void> {
  await apiClient.delete(`/environments/${id}`)
}

/**
 * Duplicate an environment
 */
export async function duplicateEnvironment(id: string): Promise<Environment> {
  const response = await apiClient.post<EnvironmentApiResponse>(`/environments/${id}/duplicate`)
  return transformApiEnvironment(response.data)
}

// ===========================================================================
// Tags API (REQ-9.5.3.4)
// ===========================================================================

/**
 * Fetch all unique tags from all environments
 * REQ-9.5.3.4: GET /environments/tags
 */
export async function fetchEnvironmentsTags(): Promise<string[]> {
  const response = await apiClient.get<string[]>('/environments/tags')
  return response.data
}

// ===========================================================================
// Environment Names (Lightweight)
// ===========================================================================

/**
 * Fetch all environments with minimal data for dropdowns.
 * Returns all environments without pagination, including only id, name, and tags.
 * GET /environments/names
 */
export async function fetchEnvironmentNames(): Promise<EnvironmentName[]> {
  const response = await apiClient.get<EnvironmentName[]>('/environments/names')
  return response.data
}
