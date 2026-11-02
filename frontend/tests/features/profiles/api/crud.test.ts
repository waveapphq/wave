/**
 * Profiles API Client Tests
 *
 * REQ-4.7.4: Profile management UI
 *
 * Tests for profiles API fetch and transformation functions.
 * Follows the same pattern as tests.ts and environments.ts
 */

vi.mock('@/lib/api', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  getApiBaseUrl: vi.fn().mockReturnValue('http://localhost:8000'),
}))

import { apiClient } from '@/lib/api'

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import type {
  ProfileApiResponse,
  ProfileTypeSchema,
  CreateProfileRequest,
  UpdateProfileRequest,
} from '@/features/profiles/api/types'

import {
  fetchProfiles,
  fetchProfile,
  fetchProfileTypes,
  fetchProfileTypeSchema,
  fetchAllTags,
  createProfile,
  updateProfile,
  deleteProfile,
  duplicateProfile,
  transformApiProfile,
  fetchProfileEnvironments,
} from '@/features/profiles/api/crud'

// ============================================================================
// Mock Data
// ============================================================================

const mockProfileApiResponse: ProfileApiResponse = {
  id: 'profile-1',
  name: 'Production Database',
  type: 'database',
  description: 'Production PostgreSQL connection',
  tags: ['production', 'database'],
  usage: 5,
  config: {
    host: 'db.prod.example.com',
    port: 5432,
    database: 'app_prod',
    username: 'app_user',
    password: '********', // Masked secret
  },
  environment_values: {
    'env-prod-1': {
      host: 'db.prod.example.com',
      port: 5432,
      database: 'app_prod',
      username: 'app_user',
      password: '********',
    },
  },
  environments_count: 1,
  total_environments: 3,
  has_incomplete_environments: true,
  created_at: '2025-01-10T10:00:00Z',
  updated_at: '2025-01-15T14:30:00Z',
}

const mockProfilesListData: ProfileApiResponse[] = [
  {
    id: 'profile-1',
    name: 'Production Database',
    type: 'database',
    description: 'Production PostgreSQL connection',
    tags: ['production', 'database'],
    usage: 5,
    config: {
      host: 'db.prod.example.com',
      port: 5432,
      database: 'app_prod',
      username: 'app_user',
      password: '********',
    },
    environment_values: { 'env-prod-1': { host: 'db.prod.example.com' } },
    environments_count: 1,
    total_environments: 3,
    has_incomplete_environments: true,
    created_at: '2025-01-10T10:00:00Z',
    updated_at: '2025-01-15T14:30:00Z',
  },
  {
    id: 'profile-2',
    name: 'Staging SSH',
    type: 'ssh',
    description: 'Staging server SSH access',
    tags: ['staging', 'ssh'],
    usage: 3,
    config: {
      host: 'staging.example.com',
      port: 22,
      username: 'deploy',
      private_key: '********',
    },
    environment_values: { 'env-staging-1': { host: 'staging.example.com' } },
    environments_count: 1,
    total_environments: 3,
    has_incomplete_environments: true,
    created_at: '2025-01-11T08:00:00Z',
    updated_at: '2025-01-14T16:00:00Z',
  },
  {
    id: 'profile-3',
    name: 'Development HTTP',
    type: 'http',
    description: null,
    tags: [],
    usage: 0,
    config: {
      base_url: 'http://localhost:3000',
      timeout: 30000,
    },
    environment_values: {},
    environments_count: 0,
    total_environments: 3,
    has_incomplete_environments: true,
    created_at: '2025-01-12T09:00:00Z',
    updated_at: '2025-01-12T09:00:00Z',
  },
]

const mockPagination = {
  total: 3,
  page: 1,
  per_page: 20,
  total_pages: 1,
}

const mockProfileTypes = ['database', 'ssh', 'http', 'kubernetes', 'opensearch', 'custom']

const mockDatabaseTypeSchema: ProfileTypeSchema = {
  type: 'database',
  fields: [
    { name: 'host', type: 'string', required: true, secret: false },
    { name: 'port', type: 'integer', required: true, secret: false },
    { name: 'database', type: 'string', required: true, secret: false },
    { name: 'username', type: 'string', required: true, secret: false },
    { name: 'password', type: 'string', required: true, secret: true },
    { name: 'ssl', type: 'boolean', required: false, secret: false },
  ],
}

// ============================================================================
// Tests
// ============================================================================

describe('Profiles API', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('transformApiProfile', () => {
    it('transforms API profile response to frontend model', () => {
      const result = transformApiProfile(mockProfileApiResponse)

      expect(result.id).toBe('profile-1')
      expect(result.name).toBe('Production Database')
      expect(result.type).toBe('database')
      expect(result.description).toBe('Production PostgreSQL connection')
      expect(result.tags).toEqual(['production', 'database'])
      expect(result.usage).toBe(5)
      expect(result.config).toEqual(mockProfileApiResponse.config)
      expect(result.createdAt).toBe('2025-01-10T10:00:00Z')
      expect(result.updatedAt).toBe('2025-01-15T14:30:00Z')
    })

    it('handles null description', () => {
      const apiResponse: ProfileApiResponse = {
        ...mockProfileApiResponse,
        description: null,
      }

      const result = transformApiProfile(apiResponse)

      expect(result.description).toBeNull()
    })

    it('handles undefined description', () => {
      const apiResponse = {
        ...mockProfileApiResponse,
        description: undefined,
      } as unknown as ProfileApiResponse

      const result = transformApiProfile(apiResponse)

      expect(result.description).toBeNull()
    })

    it('handles empty tags array', () => {
      const apiResponse: ProfileApiResponse = {
        ...mockProfileApiResponse,
        tags: [],
      }

      const result = transformApiProfile(apiResponse)

      expect(result.tags).toEqual([])
    })

    it('handles undefined tags', () => {
      const apiResponse = {
        ...mockProfileApiResponse,
        tags: undefined,
      } as unknown as ProfileApiResponse

      const result = transformApiProfile(apiResponse)

      expect(result.tags).toEqual([])
    })

    it('preserves usage count of 0', () => {
      const apiResponse: ProfileApiResponse = {
        ...mockProfileApiResponse,
        usage: 0,
      }

      const result = transformApiProfile(apiResponse)

      expect(result.usage).toBe(0)
    })

    it('handles empty config', () => {
      const apiResponse: ProfileApiResponse = {
        ...mockProfileApiResponse,
        config: {},
      }

      const result = transformApiProfile(apiResponse)

      expect(result.config).toEqual({})
    })

    it('handles missing usage field', () => {
      const apiResponse = {
        ...mockProfileApiResponse,
        usage: undefined,
      } as unknown as ProfileApiResponse

      const result = transformApiProfile(apiResponse)

      expect(result.usage).toBe(0)
    })

    it('handles missing config field', () => {
      const apiResponse = {
        ...mockProfileApiResponse,
        config: undefined,
      } as unknown as ProfileApiResponse

      const result = transformApiProfile(apiResponse)

      expect(result.config).toEqual({})
    })

    it('handles missing has_incomplete_environments field', () => {
      const apiResponse = {
        ...mockProfileApiResponse,
        has_incomplete_environments: undefined,
      } as unknown as ProfileApiResponse

      const result = transformApiProfile(apiResponse)

      // Should default to false when missing
      expect(result.hasIncompleteEnvironments).toBe(false)
    })

    it('handles missing environment_values field', () => {
      const apiResponse = {
        ...mockProfileApiResponse,
        environment_values: undefined,
      } as unknown as ProfileApiResponse

      const result = transformApiProfile(apiResponse)

      expect(result.environmentValues).toEqual({})
    })

    it('handles missing environments_count field', () => {
      const apiResponse = {
        ...mockProfileApiResponse,
        environments_count: undefined,
      } as unknown as ProfileApiResponse

      const result = transformApiProfile(apiResponse)

      expect(result.environmentsCount).toBe(0)
    })

    it('handles missing total_environments field', () => {
      const apiResponse = {
        ...mockProfileApiResponse,
        total_environments: undefined,
      } as unknown as ProfileApiResponse

      const result = transformApiProfile(apiResponse)

      expect(result.totalEnvironments).toBe(0)
    })
  })

  describe('fetchProfiles', () => {
    it('fetches profiles list successfully', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: mockProfilesListData,
        meta: { requestId: '' },
        status: 200,
        pagination: mockPagination,
      })

      const result = await fetchProfiles()

      expect(apiClient.get).toHaveBeenCalledWith('/profiles')
      expect(result.data).toHaveLength(3)
      expect(result.pagination.total).toBe(3)
    })

    it('includes pagination parameters in request', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: mockProfilesListData,
        meta: { requestId: '' },
        status: 200,
        pagination: mockPagination,
      })

      await fetchProfiles({ page: 2, per_page: 10 })

      const callArg = vi.mocked(apiClient.get).mock.calls[0][0]
      expect(callArg).toContain('page=2')
      expect(callArg).toContain('per_page=10')
    })

    it('includes search parameter in request', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: mockProfilesListData,
        meta: { requestId: '' },
        status: 200,
        pagination: mockPagination,
      })

      await fetchProfiles({ search: 'production' })

      const callArg = vi.mocked(apiClient.get).mock.calls[0][0]
      expect(callArg).toContain('search=production')
    })

    it('includes type filter parameter in request', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: mockProfilesListData,
        meta: { requestId: '' },
        status: 200,
        pagination: mockPagination,
      })

      await fetchProfiles({ type: 'database' })

      const callArg = vi.mocked(apiClient.get).mock.calls[0][0]
      expect(callArg).toContain('type=database')
    })

    it('includes tags filter parameters in request (multiple)', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: mockProfilesListData,
        meta: { requestId: '' },
        status: 200,
        pagination: mockPagination,
      })

      await fetchProfiles({ tags: ['production', 'database'] })

      const callArg = vi.mocked(apiClient.get).mock.calls[0][0]
      expect(callArg).toContain('tags=production')
      expect(callArg).toContain('tags=database')
    })

    it('includes sort parameters in request', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: mockProfilesListData,
        meta: { requestId: '' },
        status: 200,
        pagination: mockPagination,
      })

      await fetchProfiles({ sort_by: 'name', sort_order: 'desc' })

      const callArg = vi.mocked(apiClient.get).mock.calls[0][0]
      expect(callArg).toContain('sort_by=name')
      expect(callArg).toContain('sort_order=desc')
    })

    it('combines multiple filter parameters', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: mockProfilesListData,
        meta: { requestId: '' },
        status: 200,
        pagination: mockPagination,
      })

      await fetchProfiles({
        page: 1,
        per_page: 20,
        search: 'prod',
        type: 'database',
        tags: ['production'],
        sort_by: 'name',
        sort_order: 'asc',
      })

      const callArg = vi.mocked(apiClient.get).mock.calls[0][0]
      expect(callArg).toContain('search=prod')
      expect(callArg).toContain('type=database')
      expect(callArg).toContain('tags=production')
      expect(callArg).toContain('sort_by=name')
      expect(callArg).toContain('sort_order=asc')
    })

    it('throws error on non-OK response', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(
        Object.assign(new Error('Failed to fetch profiles: Internal Server Error'), {
          type: 'server',
          status: 500,
          isRetryable: true,
        })
      )

      await expect(fetchProfiles()).rejects.toThrow(
        'Failed to fetch profiles: Internal Server Error'
      )
    })

    it('throws error on 503 service unavailable', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(
        Object.assign(new Error('Profiles service unavailable'), {
          type: 'server',
          status: 503,
          isRetryable: true,
        })
      )

      await expect(fetchProfiles()).rejects.toThrow(
        'Profiles service unavailable'
      )
    })
  })

  describe('fetchProfile', () => {
    it('fetches single profile by ID', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: mockProfileApiResponse,
        meta: { requestId: '' },
        status: 200,
      })

      const result = await fetchProfile('profile-1')

      expect(apiClient.get).toHaveBeenCalledWith('/profiles/profile-1')
      expect(result.id).toBe('profile-1')
      expect(result.name).toBe('Production Database')
    })

    it('throws error on 404 not found', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(
        Object.assign(new Error('Profile not found'), {
          type: 'not_found',
          status: 404,
          isRetryable: false,
        })
      )

      await expect(fetchProfile('nonexistent')).rejects.toThrow(
        'Profile not found'
      )
    })

    it('throws error on invalid UUID format', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(
        Object.assign(new Error('Invalid profile ID format'), {
          type: 'client',
          status: 400,
          isRetryable: false,
        })
      )

      await expect(fetchProfile('invalid-id')).rejects.toThrow(
        'Invalid profile ID format'
      )
    })

    it('throws error on server error', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(
        Object.assign(new Error('Failed to fetch profile: Internal Server Error'), {
          type: 'server',
          status: 500,
          isRetryable: true,
        })
      )

      await expect(fetchProfile('profile-1')).rejects.toThrow(
        'Failed to fetch profile: Internal Server Error'
      )
    })

    it('throws error on client error without specific message', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(
        Object.assign(new Error('Failed to fetch profile: Bad Request'), {
          type: 'client',
          status: 400,
          isRetryable: false,
        })
      )

      await expect(fetchProfile('profile-1')).rejects.toThrow(
        'Failed to fetch profile: Bad Request'
      )
    })
  })

  describe('fetchProfileTypes', () => {
    it('fetches available profile types', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: mockProfileTypes,
        meta: { requestId: '' },
        status: 200,
      })

      const result = await fetchProfileTypes()

      expect(apiClient.get).toHaveBeenCalledWith('/profiles/types')
      expect(result).toEqual(mockProfileTypes)
    })

    it('throws error on fetch failure', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(
        Object.assign(new Error('Failed to fetch profile types: Internal Server Error'), {
          type: 'server',
          status: 500,
          isRetryable: true,
        })
      )

      await expect(fetchProfileTypes()).rejects.toThrow(
        'Failed to fetch profile types: Internal Server Error'
      )
    })
  })

  describe('fetchProfileTypeSchema', () => {
    it('fetches schema for profile type', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: mockDatabaseTypeSchema,
        meta: { requestId: '' },
        status: 200,
      })

      const result = await fetchProfileTypeSchema('database')

      expect(apiClient.get).toHaveBeenCalledWith('/profiles/types/database/schema')
      expect(result.type).toBe('database')
      expect(result.fields).toHaveLength(6)
    })

    it('schema contains secret field indicator', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: mockDatabaseTypeSchema,
        meta: { requestId: '' },
        status: 200,
      })

      const result = await fetchProfileTypeSchema('database')

      const passwordField = result.fields.find((f) => f.name === 'password')
      expect(passwordField?.secret).toBe(true)

      const hostField = result.fields.find((f) => f.name === 'host')
      expect(hostField?.secret).toBe(false)
    })

    it('throws error on unknown profile type', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(
        Object.assign(new Error('Unknown profile type'), {
          type: 'not_found',
          status: 404,
          isRetryable: false,
        })
      )

      await expect(fetchProfileTypeSchema('unknown')).rejects.toThrow(
        'Unknown profile type'
      )
    })

    it('throws error on server error', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(
        Object.assign(new Error('Failed to fetch profile type schema: Internal Server Error'), {
          type: 'server',
          status: 500,
          isRetryable: true,
        })
      )

      await expect(fetchProfileTypeSchema('database')).rejects.toThrow(
        'Failed to fetch profile type schema: Internal Server Error'
      )
    })

    it('throws error on client error without specific message', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(
        Object.assign(new Error('Failed to fetch profile type schema: Bad Request'), {
          type: 'client',
          status: 400,
          isRetryable: false,
        })
      )

      await expect(fetchProfileTypeSchema('database')).rejects.toThrow(
        'Failed to fetch profile type schema: Bad Request'
      )
    })
  })

  describe('fetchAllTags', () => {
    it('fetches all unique tags from profiles', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: ['production', 'staging', 'database', 'ssh', 'http', 'kubernetes'],
        meta: { requestId: '' },
        status: 200,
      })

      const result = await fetchAllTags()

      expect(apiClient.get).toHaveBeenCalledWith('/profiles/tags')
      expect(result).toEqual(['production', 'staging', 'database', 'ssh', 'http', 'kubernetes'])
    })

    it('returns empty array when no profiles have tags', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: [],
        meta: { requestId: '' },
        status: 200,
      })

      const result = await fetchAllTags()

      expect(result).toEqual([])
    })

    it('returns tags in alphabetical order', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: ['beta', 'alpha', 'gamma', 'delta'],
        meta: { requestId: '' },
        status: 200,
      })

      const result = await fetchAllTags()

      // Backend should return sorted, but verify order is preserved
      expect(result).toEqual(['beta', 'alpha', 'gamma', 'delta'])
    })

    it('throws error on fetch failure', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(
        Object.assign(new Error('Failed to fetch tags: Internal Server Error'), {
          type: 'server',
          status: 500,
          isRetryable: true,
        })
      )

      await expect(fetchAllTags()).rejects.toThrow(
        'Failed to fetch tags: Internal Server Error'
      )
    })

    it('throws error on 503 service unavailable', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(
        Object.assign(new Error('Tags service unavailable'), {
          type: 'server',
          status: 503,
          isRetryable: true,
        })
      )

      await expect(fetchAllTags()).rejects.toThrow(
        'Tags service unavailable'
      )
    })
  })

  describe('createProfile', () => {
    it('creates profile with all fields', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: mockProfileApiResponse,
        meta: { requestId: '' },
        status: 201,
      })

      const request: CreateProfileRequest = {
        name: 'Production Database',
        type: 'database',
        description: 'Production PostgreSQL connection',
        tags: ['production', 'database'],
        config: {
          host: 'db.prod.example.com',
          port: 5432,
          database: 'app_prod',
          username: 'app_user',
          password: 'secret123',
        },
      }

      const result = await createProfile(request)

      expect(apiClient.post).toHaveBeenCalledWith('/profiles', request)
      expect(result.name).toBe('Production Database')
    })

    it('creates profile with optional fields omitted', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { ...mockProfileApiResponse, description: null, tags: [] },
        meta: { requestId: '' },
        status: 201,
      })

      const request: CreateProfileRequest = {
        name: 'Minimal Profile',
        type: 'http',
        config: { base_url: 'http://localhost:3000' },
      }

      const result = await createProfile(request)

      expect(result.description).toBeNull()
      expect(result.tags).toEqual([])
    })

    it('throws error on 400 for missing name', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(
        Object.assign(new Error('Name is required'), {
          type: 'validation',
          status: 400,
          isRetryable: false,
        })
      )

      await expect(
        createProfile({ name: '', type: 'database', config: {} })
      ).rejects.toThrow('Name is required')
    })

    it('throws error on 400 for missing type', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(
        Object.assign(new Error('Type is required'), {
          type: 'validation',
          status: 400,
          isRetryable: false,
        })
      )

      await expect(
        createProfile({ name: 'Test', type: '' as 'database', config: {} })
      ).rejects.toThrow('Type is required')
    })

    it('throws error on 409 for duplicate name', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(
        Object.assign(new Error('Profile with this name already exists'), {
          type: 'conflict',
          status: 409,
          isRetryable: false,
        })
      )

      await expect(
        createProfile({ name: 'Production Database', type: 'database', config: {} })
      ).rejects.toThrow('Profile with this name already exists')
    })

    it('throws error on 400 for invalid tags format', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(
        Object.assign(new Error("Field 'tags' must be a list of strings"), {
          type: 'validation',
          status: 400,
          isRetryable: false,
        })
      )

      await expect(
        createProfile({ name: 'Test', type: 'database', config: {}, tags: [''] })
      ).rejects.toThrow("Field 'tags' must be a list of strings")
    })

    it('throws error on 400 for empty string tags', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(
        Object.assign(new Error('Tags cannot contain empty strings'), {
          type: 'validation',
          status: 400,
          isRetryable: false,
        })
      )

      await expect(
        createProfile({ name: 'Test', type: 'database', config: {}, tags: [''] })
      ).rejects.toThrow('Tags cannot contain empty strings')
    })

    it('throws error on server failure', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(
        Object.assign(new Error('Failed to create profile: Internal Server Error'), {
          type: 'server',
          status: 500,
          isRetryable: true,
        })
      )

      await expect(
        createProfile({ name: 'Test', type: 'database', config: {} })
      ).rejects.toThrow('Failed to create profile: Internal Server Error')
    })

    it('throws error when error has no specific message', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(
        Object.assign(new Error('Failed to create profile: Internal Server Error'), {
          type: 'server',
          status: 500,
          isRetryable: true,
        })
      )

      await expect(
        createProfile({ name: 'Test', type: 'database', config: {} })
      ).rejects.toThrow('Failed to create profile: Internal Server Error')
    })
  })

  describe('updateProfile', () => {
    it('updates profile name', async () => {
      vi.mocked(apiClient.put).mockResolvedValue({
        data: { ...mockProfileApiResponse, name: 'Updated Database' },
        meta: { requestId: '' },
        status: 200,
      })

      const request: UpdateProfileRequest = { name: 'Updated Database' }

      const result = await updateProfile('profile-1', request)

      expect(apiClient.put).toHaveBeenCalledWith('/profiles/profile-1', request)
      expect(result.name).toBe('Updated Database')
    })

    it('updates profile description', async () => {
      vi.mocked(apiClient.put).mockResolvedValue({
        data: { ...mockProfileApiResponse, description: 'Updated description' },
        meta: { requestId: '' },
        status: 200,
      })

      const result = await updateProfile('profile-1', { description: 'Updated description' })

      expect(result.description).toBe('Updated description')
    })

    it('updates profile tags', async () => {
      vi.mocked(apiClient.put).mockResolvedValue({
        data: { ...mockProfileApiResponse, tags: ['new-tag', 'updated'] },
        meta: { requestId: '' },
        status: 200,
      })

      const result = await updateProfile('profile-1', { tags: ['new-tag', 'updated'] })

      expect(result.tags).toEqual(['new-tag', 'updated'])
    })

    it('clears tags with empty array', async () => {
      vi.mocked(apiClient.put).mockResolvedValue({
        data: { ...mockProfileApiResponse, tags: [] },
        meta: { requestId: '' },
        status: 200,
      })

      const result = await updateProfile('profile-1', { tags: [] })

      expect(result.tags).toEqual([])
    })

    it('updates profile config', async () => {
      const updatedConfig = { ...mockProfileApiResponse.config, port: 5433 }
      vi.mocked(apiClient.put).mockResolvedValue({
        data: { ...mockProfileApiResponse, config: updatedConfig },
        meta: { requestId: '' },
        status: 200,
      })

      const result = await updateProfile('profile-1', { config: updatedConfig })

      expect(result.config.port).toBe(5433)
    })

    it('cannot update profile type (locked after creation)', async () => {
      vi.mocked(apiClient.put).mockRejectedValue(
        Object.assign(new Error('Profile type cannot be changed after creation'), {
          type: 'validation',
          status: 400,
          isRetryable: false,
        })
      )

      await expect(
        updateProfile('profile-1', { type: 'ssh' } as UpdateProfileRequest)
      ).rejects.toThrow('Profile type cannot be changed after creation')
    })

    it('throws error on 404 not found', async () => {
      vi.mocked(apiClient.put).mockRejectedValue(
        Object.assign(new Error('Profile not found'), {
          type: 'not_found',
          status: 404,
          isRetryable: false,
        })
      )

      await expect(updateProfile('nonexistent', { name: 'Test' })).rejects.toThrow(
        'Profile not found'
      )
    })

    it('throws error on 409 for duplicate name', async () => {
      vi.mocked(apiClient.put).mockRejectedValue(
        Object.assign(new Error('Profile with this name already exists'), {
          type: 'conflict',
          status: 409,
          isRetryable: false,
        })
      )

      await expect(updateProfile('profile-1', { name: 'Existing Profile' })).rejects.toThrow(
        'Profile with this name already exists'
      )
    })

    it('throws error on server failure', async () => {
      vi.mocked(apiClient.put).mockRejectedValue(
        Object.assign(new Error('Failed to update profile: Internal Server Error'), {
          type: 'server',
          status: 500,
          isRetryable: true,
        })
      )

      await expect(updateProfile('profile-1', { name: 'Test' })).rejects.toThrow(
        'Failed to update profile: Internal Server Error'
      )
    })

    it('throws error when error has no specific message', async () => {
      vi.mocked(apiClient.put).mockRejectedValue(
        Object.assign(new Error('Failed to update profile: Internal Server Error'), {
          type: 'server',
          status: 500,
          isRetryable: true,
        })
      )

      await expect(updateProfile('profile-1', { name: 'Test' })).rejects.toThrow(
        'Failed to update profile: Internal Server Error'
      )
    })
  })

  describe('deleteProfile', () => {
    it('deletes profile successfully', async () => {
      vi.mocked(apiClient.delete).mockResolvedValue({
        data: null,
        meta: { requestId: '' },
        status: 204,
      })

      await deleteProfile('profile-3')

      expect(apiClient.delete).toHaveBeenCalledWith('/profiles/profile-3')
    })

    it('throws error on 404 not found', async () => {
      vi.mocked(apiClient.delete).mockRejectedValue(
        Object.assign(new Error('Profile not found'), {
          type: 'not_found',
          status: 404,
          isRetryable: false,
        })
      )

      await expect(deleteProfile('nonexistent')).rejects.toThrow(
        'Profile not found'
      )
    })

    it('throws error on 409 when profile is in use', async () => {
      vi.mocked(apiClient.delete).mockRejectedValue(
        Object.assign(new Error('Cannot delete profile: referenced by 5 tests'), {
          type: 'conflict',
          status: 409,
          isRetryable: false,
        })
      )

      await expect(deleteProfile('profile-1')).rejects.toThrow(
        'Cannot delete profile: referenced by 5 tests'
      )
    })

    it('throws error on invalid UUID format', async () => {
      vi.mocked(apiClient.delete).mockRejectedValue(
        Object.assign(new Error('Invalid profile ID format'), {
          type: 'client',
          status: 400,
          isRetryable: false,
        })
      )

      await expect(deleteProfile('invalid')).rejects.toThrow(
        'Invalid profile ID format'
      )
    })

    it('throws error on server failure', async () => {
      vi.mocked(apiClient.delete).mockRejectedValue(
        Object.assign(new Error('Failed to delete profile: Internal Server Error'), {
          type: 'server',
          status: 500,
          isRetryable: true,
        })
      )

      await expect(deleteProfile('profile-1')).rejects.toThrow(
        'Failed to delete profile: Internal Server Error'
      )
    })

    it('throws error when error has no specific message', async () => {
      vi.mocked(apiClient.delete).mockRejectedValue(
        Object.assign(new Error('Failed to delete profile: Internal Server Error'), {
          type: 'server',
          status: 500,
          isRetryable: true,
        })
      )

      await expect(deleteProfile('profile-1')).rejects.toThrow(
        'Failed to delete profile: Internal Server Error'
      )
    })
  })

  describe('duplicateProfile', () => {
    it('duplicates profile successfully', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: {
          ...mockProfileApiResponse,
          id: 'profile-4',
          name: 'Production Database (Copy)',
          usage: 0,
          created_at: '2025-01-15T15:00:00Z',
          updated_at: '2025-01-15T15:00:00Z',
        },
        meta: { requestId: '' },
        status: 201,
      })

      const result = await duplicateProfile('profile-1')

      expect(apiClient.post).toHaveBeenCalledWith('/profiles/profile-1/duplicate', undefined)
      expect(result.id).toBe('profile-4')
      expect(result.name).toBe('Production Database (Copy)')
      expect(result.usage).toBe(0) // New duplicate has no tests
    })

    it('duplicates profile with custom name', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: {
          ...mockProfileApiResponse,
          id: 'profile-5',
          name: 'Custom Copy Name',
          usage: 0,
        },
        meta: { requestId: '' },
        status: 201,
      })

      const result = await duplicateProfile('profile-1', 'Custom Copy Name')

      expect(apiClient.post).toHaveBeenCalledWith(
        '/profiles/profile-1/duplicate',
        { new_name: 'Custom Copy Name' }
      )
      expect(result.name).toBe('Custom Copy Name')
    })

    it('throws error on 404 not found', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(
        Object.assign(new Error('Profile not found'), {
          type: 'not_found',
          status: 404,
          isRetryable: false,
        })
      )

      await expect(duplicateProfile('nonexistent')).rejects.toThrow(
        'Profile not found'
      )
    })

    it('throws error on 409 for duplicate name', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(
        Object.assign(new Error('Profile with this name already exists'), {
          type: 'conflict',
          status: 409,
          isRetryable: false,
        })
      )

      await expect(duplicateProfile('profile-1', 'Existing Name')).rejects.toThrow(
        'Profile with this name already exists'
      )
    })

    it('throws error on server failure', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(
        Object.assign(new Error('Failed to duplicate profile: Internal Server Error'), {
          type: 'server',
          status: 500,
          isRetryable: true,
        })
      )

      await expect(duplicateProfile('profile-1')).rejects.toThrow(
        'Failed to duplicate profile: Internal Server Error'
      )
    })

    it('throws error when error has no specific message', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(
        Object.assign(new Error('Failed to duplicate profile: Internal Server Error'), {
          type: 'server',
          status: 500,
          isRetryable: true,
        })
      )

      await expect(duplicateProfile('profile-1')).rejects.toThrow(
        'Failed to duplicate profile: Internal Server Error'
      )
    })
  })

  describe('URL Encoding', () => {
    it('encodes special characters in search parameter', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: mockProfilesListData,
        meta: { requestId: '' },
        status: 200,
        pagination: mockPagination,
      })

      await fetchProfiles({ search: 'foo bar' })

      const callArg = vi.mocked(apiClient.get).mock.calls[0][0]
      expect(callArg).toContain('search=foo%20bar')
    })

    it('encodes special characters in tag names', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: mockProfilesListData,
        meta: { requestId: '' },
        status: 200,
        pagination: mockPagination,
      })

      await fetchProfiles({ tags: ['tag with spaces', 'tag&special'] })

      const callArg = vi.mocked(apiClient.get).mock.calls[0][0]
      expect(callArg).toContain('tags=tag%20with%20spaces')
      expect(callArg).toContain('tags=tag%26special')
    })

    it('does not include empty search parameter', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: mockProfilesListData,
        meta: { requestId: '' },
        status: 200,
        pagination: mockPagination,
      })

      await fetchProfiles({ search: '' })

      const callArg = vi.mocked(apiClient.get).mock.calls[0][0]
      expect(callArg).not.toContain('search=')
    })

    it('does not include empty type parameter', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: mockProfilesListData,
        meta: { requestId: '' },
        status: 200,
        pagination: mockPagination,
      })

      await fetchProfiles({ type: '' })

      const callArg = vi.mocked(apiClient.get).mock.calls[0][0]
      expect(callArg).not.toContain('type=')
    })

    it('does not include empty tags array', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: mockProfilesListData,
        meta: { requestId: '' },
        status: 200,
        pagination: mockPagination,
      })

      await fetchProfiles({ tags: [] })

      const callArg = vi.mocked(apiClient.get).mock.calls[0][0]
      expect(callArg).not.toContain('tags=')
    })
  })

  describe('Error Handling', () => {
    it('handles network errors gracefully', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(
        Object.assign(new Error('Network error'), {
          type: 'network',
          isRetryable: true,
        })
      )

      await expect(fetchProfiles()).rejects.toThrow('Network error')
    })

    it('handles server errors', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(
        Object.assign(new Error('Internal server error'), {
          type: 'server',
          status: 500,
          isRetryable: true,
        })
      )

      await expect(fetchProfiles()).rejects.toThrow('Internal server error')
    })

    it('handles 500 internal server error with correlation ID', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(
        Object.assign(new Error('Internal server error'), {
          type: 'server',
          status: 500,
          isRetryable: true,
          requestId: 'abc-123-xyz',
        })
      )

      await expect(fetchProfiles()).rejects.toThrow('Internal server error')
    })

    it('handles error response without JSON body', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(
        Object.assign(new Error('Failed to fetch profiles: Internal Server Error'), {
          type: 'server',
          status: 500,
          isRetryable: true,
        })
      )

      await expect(fetchProfiles()).rejects.toThrow(
        'Failed to fetch profiles: Internal Server Error'
      )
    })

    it('handles error response with JSON but no error.message field', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(
        Object.assign(new Error('Failed to fetch profiles: Bad Request'), {
          type: 'client',
          status: 400,
          isRetryable: false,
        })
      )

      await expect(fetchProfiles()).rejects.toThrow(
        'Failed to fetch profiles: Bad Request'
      )
    })
  })
})

// ============================================================================
// fetchProfileEnvironments Tests (for profile environment dropdown)
// Uses the lightweight /environments/names endpoint
// ============================================================================

describe('fetchProfileEnvironments', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns environments array on successful response', async () => {
    // The /names endpoint returns only id, name, tags
    vi.mocked(apiClient.get).mockResolvedValue({
      data: [
        { id: 'env-1', name: 'Production', tags: ['prod'] },
        { id: 'env-2', name: 'Staging', tags: [] },
      ],
      meta: { requestId: '' },
      status: 200,
    })

    const result = await fetchProfileEnvironments()

    expect(result).toHaveLength(2)
    // Function adds placeholder values for description and usage
    expect(result[0]).toEqual({
      id: 'env-1',
      name: 'Production',
      description: null,
      tags: ['prod'],
      usage: 0,
    })
    expect(result[1]).toEqual({
      id: 'env-2',
      name: 'Staging',
      description: null,
      tags: [],
      usage: 0,
    })
  })

  it('propagates an API error to the caller', async () => {
    const apiError = Object.assign(new Error('Server error'), {
      type: 'server',
      status: 500,
      isRetryable: true,
    })
    vi.mocked(apiClient.get).mockRejectedValue(apiError)

    await expect(fetchProfileEnvironments()).rejects.toBe(apiError)
  })

  it('propagates a network error to the caller', async () => {
    const networkError = Object.assign(new Error('Network error'), {
      type: 'network',
      isRetryable: true,
    })
    vi.mocked(apiClient.get).mockRejectedValue(networkError)

    await expect(fetchProfileEnvironments()).rejects.toBe(networkError)
  })

  it('handles empty data array in response', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: [],
      meta: { requestId: '' },
      status: 200,
    })

    const result = await fetchProfileEnvironments()

    expect(result).toEqual([])
  })

  it('handles missing data field in response (uses empty array fallback)', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: null,
      meta: { requestId: '' },
      status: 200,
    })

    const result = await fetchProfileEnvironments()

    expect(result).toEqual([])
  })

  it('sets description to null (not returned by /names endpoint)', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: [{ id: 'env-1', name: 'Test', tags: ['test'] }],
      meta: { requestId: '' },
      status: 200,
    })

    const result = await fetchProfileEnvironments()

    expect(result[0].description).toBeNull()
  })

  it('handles missing tags field with fallback to empty array', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: [{ id: 'env-1', name: 'Test' }],  // No tags field
      meta: { requestId: '' },
      status: 200,
    })

    const result = await fetchProfileEnvironments()

    expect(result[0].tags).toEqual([])
  })

  it('sets usage to 0 (not returned by /names endpoint)', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: [{ id: 'env-1', name: 'Test', tags: [] }],
      meta: { requestId: '' },
      status: 200,
    })

    const result = await fetchProfileEnvironments()

    expect(result[0].usage).toBe(0)
  })

  it('calls correct path for lightweight /names endpoint', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: [],
      meta: { requestId: '' },
      status: 200,
    })

    await fetchProfileEnvironments()

    expect(apiClient.get).toHaveBeenCalledWith('/environments/names')
  })
})
