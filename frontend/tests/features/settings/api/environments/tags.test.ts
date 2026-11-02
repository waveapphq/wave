/**
 * Environments Tags and Names API Client Tests
 *
 * REQ-9.5.3.4: GET /environments/tags - Return unique tags across all environments
 * GET /environments/names - Return all environments with minimal data for dropdowns
 *
 * Tests for the environments tags and names fetch functions.
 * These endpoints return data for filter dropdowns and selection UI.
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

// These functions are implemented in src/api/environments.ts
import { fetchEnvironmentsTags, fetchEnvironmentNames } from '@/features/settings/api/environments/crud'

// ============================================================================
// Environments Tags API Tests (REQ-9.5.3.4)
// ============================================================================

describe('Environments Tags API', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('fetchEnvironmentsTags', () => {
    it('fetches all unique tags from environments successfully', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: ['development', 'production', 'qa', 'staging'],
        meta: { requestId: '' },
        status: 200,
      })

      const result = await fetchEnvironmentsTags()

      expect(apiClient.get).toHaveBeenCalledWith('/environments/tags')
      expect(result).toEqual(['development', 'production', 'qa', 'staging'])
    })

    it('returns empty array when no environments have tags', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: [],
        meta: { requestId: '' },
        status: 200,
      })

      const result = await fetchEnvironmentsTags()

      expect(result).toEqual([])
    })

    it('preserves tag order from backend (sorted alphabetically)', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: ['aws', 'azure', 'gcp', 'local'],
        meta: { requestId: '' },
        status: 200,
      })

      const result = await fetchEnvironmentsTags()

      // Backend returns sorted, we preserve that order
      expect(result).toEqual(['aws', 'azure', 'gcp', 'local'])
    })

    it('throws error on 503 service unavailable', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(
        Object.assign(new Error('Tags service unavailable'), {
          type: 'server',
          status: 503,
          isRetryable: true,
        })
      )

      await expect(fetchEnvironmentsTags()).rejects.toThrow(
        'Tags service unavailable'
      )
    })

    it('throws error on general fetch failure', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(
        Object.assign(new Error('Failed to fetch environments tags: Internal Server Error'), {
          type: 'server',
          status: 500,
          isRetryable: true,
        })
      )

      await expect(fetchEnvironmentsTags()).rejects.toThrow(
        'Failed to fetch environments tags: Internal Server Error'
      )
    })

    it('throws error on network failure', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(
        Object.assign(new Error('Network error'), {
          type: 'network',
          isRetryable: true,
        })
      )

      await expect(fetchEnvironmentsTags()).rejects.toThrow('Network error')
    })

    it('handles response with meta field', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: ['cloud', 'on-prem'],
        meta: {
          requestId: 'test-123',
          timestamp: '2025-01-15T12:00:00Z',
        },
        status: 200,
      })

      const result = await fetchEnvironmentsTags()

      expect(result).toEqual(['cloud', 'on-prem'])
    })
  })
})

// ============================================================================
// Environment Names API Tests (Lightweight for Dropdowns)
// ============================================================================

describe('Environment Names API', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('fetchEnvironmentNames', () => {
    it('fetches all environments with minimal data successfully', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: [
          { id: 'env-1', name: 'Alpha', tags: ['prod'] },
          { id: 'env-2', name: 'Beta', tags: [] },
          { id: 'env-3', name: 'Gamma', tags: ['dev', 'test'] },
        ],
        meta: { requestId: '' },
        status: 200,
      })

      const result = await fetchEnvironmentNames()

      expect(apiClient.get).toHaveBeenCalledWith('/environments/names')
      expect(result).toHaveLength(3)
      expect(result[0]).toEqual({ id: 'env-1', name: 'Alpha', tags: ['prod'] })
    })

    it('returns only id, name, and tags fields', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: [{ id: 'env-1', name: 'Production', tags: ['critical'] }],
        meta: { requestId: '' },
        status: 200,
      })

      const result = await fetchEnvironmentNames()

      expect(result).toHaveLength(1)
      const env = result[0]
      expect(Object.keys(env).sort()).toEqual(['id', 'name', 'tags'])
    })

    it('returns empty array when no environments exist', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: [],
        meta: { requestId: '' },
        status: 200,
      })

      const result = await fetchEnvironmentNames()

      expect(result).toEqual([])
    })

    it('preserves order from backend (sorted by name)', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: [
          { id: 'env-1', name: 'Alpha', tags: [] },
          { id: 'env-2', name: 'Beta', tags: [] },
          { id: 'env-3', name: 'Gamma', tags: [] },
        ],
        meta: { requestId: '' },
        status: 200,
      })

      const result = await fetchEnvironmentNames()

      const names = result.map((e) => e.name)
      expect(names).toEqual(['Alpha', 'Beta', 'Gamma'])
    })

    it('throws error on 503 service unavailable', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(
        Object.assign(new Error('Environment names service unavailable'), {
          type: 'server',
          status: 503,
          isRetryable: true,
        })
      )

      await expect(fetchEnvironmentNames()).rejects.toThrow(
        'Environment names service unavailable'
      )
    })

    it('throws error on general fetch failure', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(
        Object.assign(new Error('Failed to fetch environment names: Internal Server Error'), {
          type: 'server',
          status: 500,
          isRetryable: true,
        })
      )

      await expect(fetchEnvironmentNames()).rejects.toThrow(
        'Failed to fetch environment names: Internal Server Error'
      )
    })

    it('throws error on network failure', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(
        Object.assign(new Error('Network error'), {
          type: 'network',
          isRetryable: true,
        })
      )

      await expect(fetchEnvironmentNames()).rejects.toThrow('Network error')
    })
  })
})
