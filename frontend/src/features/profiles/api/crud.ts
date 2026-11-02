/**
 * Profiles CRUD API Client
 *
 * REQ-4.7.4: Profile management UI
 *
 * Fetches profile data from the backend API and transforms it
 * for the ProfilesPage component.
 */

import { apiClient } from '@/lib/api'
import type {
  ProfileApiResponse,
  ProfilesPagination,
  ProfileTypeSchema,
  CreateProfileRequest,
  UpdateProfileRequest,
  Profile,
  Environment,
} from './types'

// ============================================================================
// Transform Functions
// ============================================================================

/**
 * Transform API profile response to frontend model
 */
export function transformApiProfile(api: ProfileApiResponse): Profile {
  return {
    id: api.id,
    name: api.name,
    type: api.type,
    description: api.description ?? null,
    tags: api.tags ?? [],
    usage: api.usage ?? 0,
    config: api.config ?? {},
    environmentValues: api.environment_values ?? {},
    environmentsCount: api.environments_count ?? 0,
    totalEnvironments: api.total_environments ?? 0,
    hasIncompleteEnvironments: api.has_incomplete_environments ?? false,
    createdAt: api.created_at,
    updatedAt: api.updated_at,
  }
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * Fetch profiles from the API with optional filters
 */
export async function fetchProfiles(params?: {
  page?: number
  per_page?: number
  search?: string
  type?: string
  tags?: string[]
  sort_by?: string
  sort_order?: 'asc' | 'desc'
}): Promise<{ data: Profile[]; pagination: ProfilesPagination }> {
  const queryParts: string[] = []

  if (params?.page) {
    queryParts.push(`page=${params.page}`)
  }
  if (params?.per_page) {
    queryParts.push(`per_page=${params.per_page}`)
  }
  if (params?.search) {
    queryParts.push(`search=${encodeURIComponent(params.search)}`)
  }
  if (params?.type) {
    queryParts.push(`type=${encodeURIComponent(params.type)}`)
  }
  if (params?.tags && params.tags.length > 0) {
    for (const tag of params.tags) {
      queryParts.push(`tags=${encodeURIComponent(tag)}`)
    }
  }
  if (params?.sort_by) {
    queryParts.push(`sort_by=${encodeURIComponent(params.sort_by)}`)
  }
  if (params?.sort_order) {
    queryParts.push(`sort_order=${encodeURIComponent(params.sort_order)}`)
  }

  const queryString = queryParts.length > 0 ? `?${queryParts.join('&')}` : ''
  const path = `/profiles${queryString}`

  const response = await apiClient.get<ProfileApiResponse[], ProfilesPagination>(path)

  return {
    data: response.data.map(transformApiProfile),
    pagination: response.pagination!,
  }
}

/**
 * Fetch single profile by ID
 */
export async function fetchProfile(id: string): Promise<Profile> {
  const response = await apiClient.get<ProfileApiResponse>(`/profiles/${id}`)
  return transformApiProfile(response.data)
}

/**
 * Fetch available profile types
 */
export async function fetchProfileTypes(): Promise<string[]> {
  const response = await apiClient.get<string[]>('/profiles/types')
  return response.data
}

/**
 * Fetch schema for a profile type
 */
export async function fetchProfileTypeSchema(type: string): Promise<ProfileTypeSchema> {
  const response = await apiClient.get<ProfileTypeSchema>(`/profiles/types/${type}/schema`)
  return response.data
}

/**
 * Fetch all unique tags from profiles
 */
export async function fetchAllTags(): Promise<string[]> {
  const response = await apiClient.get<string[]>('/profiles/tags')
  return response.data
}

/**
 * Fetch all environments for dropdown (lightweight)
 * Uses /environments/names endpoint which returns all environments with minimal data.
 */
export async function fetchProfileEnvironments(): Promise<Environment[]> {
  const response = await apiClient.get<{ id: string; name: string; tags?: string[] }[]>(
    '/environments/names'
  )
  // The /names endpoint returns { id, name, tags } - add placeholder values for other fields
  return (response.data || []).map((e) => ({
    id: e.id,
    name: e.name,
    description: null, // Not returned by /names endpoint
    tags: e.tags ?? [],
    usage: 0, // Not returned by /names endpoint
  }))
}

/**
 * Create a new profile
 */
export async function createProfile(request: CreateProfileRequest): Promise<Profile> {
  const response = await apiClient.post<ProfileApiResponse>('/profiles', request)
  return transformApiProfile(response.data)
}

/**
 * Update an existing profile
 */
export async function updateProfile(
  id: string,
  request: UpdateProfileRequest
): Promise<Profile> {
  const response = await apiClient.put<ProfileApiResponse>(`/profiles/${id}`, request)
  return transformApiProfile(response.data)
}

/**
 * Delete a profile
 */
export async function deleteProfile(id: string): Promise<void> {
  await apiClient.delete(`/profiles/${id}`)
}

/**
 * Duplicate a profile
 */
export async function duplicateProfile(
  id: string,
  newName?: string
): Promise<Profile> {
  const body = newName ? { new_name: newName } : undefined
  const response = await apiClient.post<ProfileApiResponse>(
    `/profiles/${id}/duplicate`,
    body
  )
  return transformApiProfile(response.data)
}
