/**
 * Environments API Client Tests
 *
 * REQ-5.2.1.42: Settings and preferences screen - Environments management
 *
 * Tests for environments API fetch and transformation functions.
 * Follows the same pattern as dashboard.test.ts and tests.ts
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
  EnvironmentApiResponse,
  CreateEnvironmentRequest,
  UpdateEnvironmentRequest,
} from '@/features/settings/api/environments/types'

import {
  fetchEnvironments,
  fetchEnvironment,
  createEnvironment,
  updateEnvironment,
  deleteEnvironment,
  duplicateEnvironment,
  transformApiEnvironment,
} from '@/features/settings/api/environments/crud'

// ============================================================================
// Mock Data
// ============================================================================

const mockEnvironmentApiResponse: EnvironmentApiResponse = {
  id: 'env-1',
  name: 'Production',
  description: 'Production environment',
  usage: 5,
  created_at: '2025-01-10T10:00:00Z',
  updated_at: '2025-01-15T14:30:00Z',
}

const mockEnvironmentsListData: EnvironmentApiResponse[] = [
  {
    id: 'env-1',
    name: 'Production',
    description: 'Production environment',
    usage: 5,
    created_at: '2025-01-10T10:00:00Z',
    updated_at: '2025-01-15T14:30:00Z',
  },
  {
    id: 'env-2',
    name: 'Staging',
    description: 'Staging environment for testing',
    usage: 3,
    created_at: '2025-01-11T08:00:00Z',
    updated_at: '2025-01-14T16:00:00Z',
  },
  {
    id: 'env-3',
    name: 'Development',
    description: null,
    usage: 0,
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

// ============================================================================
// Tests
// ============================================================================

describe('Environments API', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('transformApiEnvironment', () => {
    it('transforms API environment response to frontend model', () => {
      const result = transformApiEnvironment(mockEnvironmentApiResponse)

      expect(result.id).toBe('env-1')
      expect(result.name).toBe('Production')
      expect(result.description).toBe('Production environment')
      expect(result.usage).toBe(5)
      expect(result.createdAt).toBe('2025-01-10T10:00:00Z')
      expect(result.updatedAt).toBe('2025-01-15T14:30:00Z')
    })

    it('handles null description', () => {
      const apiResponse: EnvironmentApiResponse = {
        ...mockEnvironmentApiResponse,
        description: null,
      }

      const result = transformApiEnvironment(apiResponse)

      expect(result.description).toBeNull()
    })

    it('handles undefined description', () => {
      const apiResponse: EnvironmentApiResponse = {
        id: 'env-1',
        name: 'Test',
        usage: 0,
        created_at: '2025-01-10T10:00:00Z',
        updated_at: '2025-01-10T10:00:00Z',
      } as EnvironmentApiResponse

      const result = transformApiEnvironment(apiResponse)

      expect(result.description).toBeNull()
    })

    it('preserves usage count of 0', () => {
      const apiResponse: EnvironmentApiResponse = {
        ...mockEnvironmentApiResponse,
        usage: 0,
      }

      const result = transformApiEnvironment(apiResponse)

      expect(result.usage).toBe(0)
    })
  })

  describe('fetchEnvironments', () => {
    it('fetches environments list successfully', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: mockEnvironmentsListData,
        meta: { requestId: '' },
        status: 200,
        pagination: mockPagination,
      })

      const result = await fetchEnvironments()

      expect(apiClient.get).toHaveBeenCalledWith('/environments')
      expect(result.data).toHaveLength(3)
      expect(result.pagination.total).toBe(3)
    })

    it('includes pagination parameters in request', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: mockEnvironmentsListData,
        meta: { requestId: '' },
        status: 200,
        pagination: mockPagination,
      })

      await fetchEnvironments({ page: 2, per_page: 10 })

      expect(apiClient.get).toHaveBeenCalledWith(
        expect.stringMatching(/page=2/)
      )
      expect(apiClient.get).toHaveBeenCalledWith(
        expect.stringMatching(/per_page=10/)
      )
    })

    it('includes search parameter in request', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: mockEnvironmentsListData,
        meta: { requestId: '' },
        status: 200,
        pagination: mockPagination,
      })

      await fetchEnvironments({ search: 'prod' })

      expect(apiClient.get).toHaveBeenCalledWith(
        expect.stringMatching(/search=prod/)
      )
    })

    it('includes sort parameters in request', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: mockEnvironmentsListData,
        meta: { requestId: '' },
        status: 200,
        pagination: mockPagination,
      })

      await fetchEnvironments({ sort_by: 'name', sort_direction: 'asc' })

      expect(apiClient.get).toHaveBeenCalledWith(
        expect.stringMatching(/sort_by=name/)
      )
      expect(apiClient.get).toHaveBeenCalledWith(
        expect.stringMatching(/sort_direction=asc/)
      )
    })

    it('includes tags filter in request', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: mockEnvironmentsListData,
        meta: { requestId: '' },
        status: 200,
        pagination: mockPagination,
      })

      await fetchEnvironments({ tags: ['production', 'critical'] })

      // Tags are sent as comma-separated (URL-encoded comma = %2C)
      expect(apiClient.get).toHaveBeenCalledWith(
        expect.stringMatching(/tags=production%2Ccritical/)
      )
    })

    it('throws error on non-OK response', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(
        Object.assign(new Error('Failed to fetch environments: Internal Server Error'), {
          type: 'server',
          status: 500,
          isRetryable: true,
        })
      )

      await expect(fetchEnvironments()).rejects.toThrow(
        'Failed to fetch environments: Internal Server Error'
      )
    })

    it('throws error on 503 service unavailable', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(
        Object.assign(new Error('Environments service unavailable'), {
          type: 'server',
          status: 503,
          isRetryable: true,
        })
      )

      await expect(fetchEnvironments()).rejects.toThrow(
        'Environments service unavailable'
      )
    })

    it('uses correct base path', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: mockEnvironmentsListData,
        meta: { requestId: '' },
        status: 200,
        pagination: mockPagination,
      })

      await fetchEnvironments()

      expect(apiClient.get).toHaveBeenCalledWith('/environments')
    })
  })

  describe('fetchEnvironment', () => {
    it('fetches single environment by ID', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: mockEnvironmentApiResponse,
        meta: { requestId: '' },
        status: 200,
      })

      const result = await fetchEnvironment('env-1')

      expect(apiClient.get).toHaveBeenCalledWith('/environments/env-1')
      expect(result.id).toBe('env-1')
      expect(result.name).toBe('Production')
    })

    it('throws error on 404 not found', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(
        Object.assign(new Error('Environment not found'), {
          type: 'not_found',
          status: 404,
          isRetryable: false,
        })
      )

      await expect(fetchEnvironment('nonexistent')).rejects.toThrow(
        'Environment not found'
      )
    })

    it('throws error on invalid UUID format', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(
        Object.assign(new Error('Invalid environment ID format'), {
          type: 'client',
          status: 400,
          isRetryable: false,
        })
      )

      await expect(fetchEnvironment('invalid-id')).rejects.toThrow(
        'Invalid environment ID format'
      )
    })
  })

  describe('createEnvironment', () => {
    it('creates environment with name and description', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: mockEnvironmentApiResponse,
        meta: { requestId: '' },
        status: 201,
      })

      const request: CreateEnvironmentRequest = {
        name: 'Production',
        description: 'Production environment',
      }

      const result = await createEnvironment(request)

      expect(apiClient.post).toHaveBeenCalledWith('/environments', request)
      expect(result.name).toBe('Production')
    })

    it('creates environment with name only (description optional)', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { ...mockEnvironmentApiResponse, description: null },
        meta: { requestId: '' },
        status: 201,
      })

      const request: CreateEnvironmentRequest = { name: 'Test' }

      const result = await createEnvironment(request)

      expect(result.description).toBeNull()
    })

    it('throws error on 400 for missing name', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(
        Object.assign(new Error('Name is required'), {
          type: 'validation',
          status: 400,
          isRetryable: false,
        })
      )

      await expect(createEnvironment({ name: '' })).rejects.toThrow(
        'Name is required'
      )
    })

    it('throws error on 409 for duplicate name', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(
        Object.assign(new Error('Environment with this name already exists'), {
          type: 'conflict',
          status: 409,
          isRetryable: false,
        })
      )

      await expect(createEnvironment({ name: 'Production' })).rejects.toThrow(
        'Environment with this name already exists'
      )
    })

    it('throws error on 400 for name too long', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(
        Object.assign(new Error('Name must not exceed 255 characters'), {
          type: 'validation',
          status: 400,
          isRetryable: false,
        })
      )

      const longName = 'a'.repeat(256)
      await expect(createEnvironment({ name: longName })).rejects.toThrow(
        'Name must not exceed 255 characters'
      )
    })
  })

  describe('updateEnvironment', () => {
    it('updates environment name', async () => {
      vi.mocked(apiClient.put).mockResolvedValue({
        data: { ...mockEnvironmentApiResponse, name: 'Production v2' },
        meta: { requestId: '' },
        status: 200,
      })

      const request: UpdateEnvironmentRequest = { name: 'Production v2' }

      const result = await updateEnvironment('env-1', request)

      expect(apiClient.put).toHaveBeenCalledWith('/environments/env-1', request)
      expect(result.name).toBe('Production v2')
    })

    it('updates environment description', async () => {
      vi.mocked(apiClient.put).mockResolvedValue({
        data: { ...mockEnvironmentApiResponse, description: 'Updated description' },
        meta: { requestId: '' },
        status: 200,
      })

      const result = await updateEnvironment('env-1', { description: 'Updated description' })

      expect(result.description).toBe('Updated description')
    })

    it('clears description with null', async () => {
      vi.mocked(apiClient.put).mockResolvedValue({
        data: { ...mockEnvironmentApiResponse, description: null },
        meta: { requestId: '' },
        status: 200,
      })

      const result = await updateEnvironment('env-1', { description: null })

      expect(result.description).toBeNull()
    })

    it('throws error on 404 not found', async () => {
      vi.mocked(apiClient.put).mockRejectedValue(
        Object.assign(new Error('Environment not found'), {
          type: 'not_found',
          status: 404,
          isRetryable: false,
        })
      )

      await expect(updateEnvironment('nonexistent', { name: 'Test' })).rejects.toThrow(
        'Environment not found'
      )
    })

    it('throws error on 409 for duplicate name', async () => {
      vi.mocked(apiClient.put).mockRejectedValue(
        Object.assign(new Error('Environment with this name already exists'), {
          type: 'conflict',
          status: 409,
          isRetryable: false,
        })
      )

      await expect(updateEnvironment('env-1', { name: 'Staging' })).rejects.toThrow(
        'Environment with this name already exists'
      )
    })

    it('throws error on 400 for empty body', async () => {
      vi.mocked(apiClient.put).mockRejectedValue(
        Object.assign(new Error('Request body cannot be empty'), {
          type: 'validation',
          status: 400,
          isRetryable: false,
        })
      )

      await expect(updateEnvironment('env-1', {})).rejects.toThrow(
        'Request body cannot be empty'
      )
    })
  })

  describe('deleteEnvironment', () => {
    it('deletes environment successfully', async () => {
      vi.mocked(apiClient.delete).mockResolvedValue({
        data: null,
        meta: { requestId: '' },
        status: 204,
      })

      await deleteEnvironment('env-3')

      expect(apiClient.delete).toHaveBeenCalledWith('/environments/env-3')
    })

    it('throws error on 404 not found', async () => {
      vi.mocked(apiClient.delete).mockRejectedValue(
        Object.assign(new Error('Environment not found'), {
          type: 'not_found',
          status: 404,
          isRetryable: false,
        })
      )

      await expect(deleteEnvironment('nonexistent')).rejects.toThrow(
        'Environment not found'
      )
    })

    it('throws error on 409 when environment is in use (SETTINGS-12)', async () => {
      vi.mocked(apiClient.delete).mockRejectedValue(
        Object.assign(new Error('Cannot delete environment: referenced by 5 profiles'), {
          type: 'conflict',
          status: 409,
          isRetryable: false,
        })
      )

      await expect(deleteEnvironment('env-1')).rejects.toThrow(
        'Cannot delete environment: referenced by 5 profiles'
      )
    })

    it('throws error on invalid UUID format', async () => {
      vi.mocked(apiClient.delete).mockRejectedValue(
        Object.assign(new Error('Invalid environment ID format'), {
          type: 'client',
          status: 400,
          isRetryable: false,
        })
      )

      await expect(deleteEnvironment('invalid')).rejects.toThrow(
        'Invalid environment ID format'
      )
    })
  })

  describe('duplicateEnvironment', () => {
    it('duplicates environment successfully', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: {
          ...mockEnvironmentApiResponse,
          id: 'env-4',
          name: 'Production (Copy)',
          usage: 0,
          created_at: '2025-01-15T15:00:00Z',
          updated_at: '2025-01-15T15:00:00Z',
        },
        meta: { requestId: '' },
        status: 201,
      })

      const result = await duplicateEnvironment('env-1')

      expect(apiClient.post).toHaveBeenCalledWith('/environments/env-1/duplicate')
      expect(result.id).toBe('env-4')
      expect(result.name).toBe('Production (Copy)')
      expect(result.usage).toBe(0) // New duplicate has no profiles
    })

    it('throws error on 404 not found', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(
        Object.assign(new Error('Environment not found'), {
          type: 'not_found',
          status: 404,
          isRetryable: false,
        })
      )

      await expect(duplicateEnvironment('nonexistent')).rejects.toThrow(
        'Environment not found'
      )
    })

    it('throws error on invalid UUID format', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(
        Object.assign(new Error('Invalid environment ID format'), {
          type: 'client',
          status: 400,
          isRetryable: false,
        })
      )

      await expect(duplicateEnvironment('invalid')).rejects.toThrow(
        'Invalid environment ID format'
      )
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

      await expect(fetchEnvironments()).rejects.toThrow('Network error')
    })

    it('handles server errors', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(
        Object.assign(new Error('Internal server error'), {
          type: 'server',
          status: 500,
          isRetryable: true,
        })
      )

      await expect(fetchEnvironments()).rejects.toThrow('Internal server error')
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

      await expect(fetchEnvironments()).rejects.toThrow('Internal server error')
    })

    it('handles error response without JSON body', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(
        Object.assign(new Error('Failed to fetch environments: Internal Server Error'), {
          type: 'server',
          status: 500,
          isRetryable: true,
        })
      )

      await expect(fetchEnvironments()).rejects.toThrow(
        'Failed to fetch environments: Internal Server Error'
      )
    })

    it('handles error response with no error.message field', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(
        Object.assign(new Error('Failed to fetch environments: Bad Request'), {
          type: 'client',
          status: 400,
          isRetryable: false,
        })
      )

      await expect(fetchEnvironments()).rejects.toThrow(
        'Failed to fetch environments: Bad Request'
      )
    })
  })
})
