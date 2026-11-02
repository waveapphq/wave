/**
 * Tests Tags API Client Tests
 *
 * REQ-9.5.3.1: GET /tests/tags - Return unique tags across all tests
 *
 * Tests for the tests tags fetch function.
 * This endpoint returns all unique tags from tests for filter dropdowns.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

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

import { fetchTestsTags } from '@/features/tests/api/crud'

// ============================================================================
// Tests Tags API Tests (REQ-9.5.3.1)
// ============================================================================

describe('Tests Tags API', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('fetchTestsTags', () => {
    it('fetches all unique tags from tests successfully', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: ['api', 'integration', 'smoke', 'unit'],
        meta: { requestId: '' },
        status: 200,
      })

      const result = await fetchTestsTags()

      expect(apiClient.get).toHaveBeenCalledWith('/tests/tags')
      expect(result).toEqual(['api', 'integration', 'smoke', 'unit'])
    })

    it('returns empty array when no tests have tags', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: [],
        meta: { requestId: '' },
        status: 200,
      })

      const result = await fetchTestsTags()

      expect(result).toEqual([])
    })

    it('preserves tag order from backend (sorted alphabetically)', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: ['alpha', 'beta', 'gamma', 'zeta'],
        meta: { requestId: '' },
        status: 200,
      })

      const result = await fetchTestsTags()

      // Backend returns sorted, we preserve that order
      expect(result).toEqual(['alpha', 'beta', 'gamma', 'zeta'])
    })

    it('throws error on 503 service unavailable', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(
        Object.assign(new Error('Service Unavailable'), { type: 'server', status: 503, isRetryable: true })
      )

      await expect(fetchTestsTags()).rejects.toThrow('Service Unavailable')
    })

    it('throws error on general fetch failure', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(
        Object.assign(new Error('Internal Server Error'), { type: 'server', status: 500, isRetryable: true })
      )

      await expect(fetchTestsTags()).rejects.toThrow('Internal Server Error')
    })

    it('throws error on network failure', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(
        Object.assign(new Error('Network error'), { type: 'network', status: undefined, isRetryable: true })
      )

      await expect(fetchTestsTags()).rejects.toThrow('Network error')
    })

    it('handles response with meta field', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: ['regression', 'smoke'],
        meta: {
          requestId: 'test-123',
          timestamp: '2025-01-15T12:00:00Z',
        },
        status: 200,
      })

      const result = await fetchTestsTags()

      expect(result).toEqual(['regression', 'smoke'])
    })
  })
})
