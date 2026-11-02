/**
 * Regressions Tags API Client Tests
 *
 * REQ-9.5.3.3: GET /regressions/tags - Return unique tags across all regressions
 *
 * Tests for the regressions tags fetch function.
 * This endpoint returns all unique tags from regressions for filter dropdowns.
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

import { fetchRegressionsTags } from '@/features/regressions/api/crud'

// ============================================================================
// Regressions Tags API Tests (REQ-9.5.3.3)
// ============================================================================

describe('Regressions Tags API', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('fetchRegressionsTags', () => {
    it('fetches all unique tags from regressions successfully', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: ['full', 'nightly', 'release', 'sanity'],
        meta: { requestId: '' },
        status: 200,
      })

      const result = await fetchRegressionsTags()

      expect(apiClient.get).toHaveBeenCalledWith('/regressions/tags')
      expect(result).toEqual(['full', 'nightly', 'release', 'sanity'])
    })

    it('returns empty array when no regressions have tags', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: [],
        meta: { requestId: '' },
        status: 200,
      })

      const result = await fetchRegressionsTags()

      expect(result).toEqual([])
    })

    it('preserves tag order from backend (sorted alphabetically)', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: ['alpha', 'beta', 'gamma', 'zeta'],
        meta: { requestId: '' },
        status: 200,
      })

      const result = await fetchRegressionsTags()

      // Backend returns sorted, we preserve that order
      expect(result).toEqual(['alpha', 'beta', 'gamma', 'zeta'])
    })

    it('throws error on 503 service unavailable', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(
        Object.assign(new Error('Service Unavailable'), {
          type: 'server',
          status: 503,
          isRetryable: true,
        })
      )

      await expect(fetchRegressionsTags()).rejects.toThrow(
        'Service Unavailable'
      )
    })

    it('throws error on general fetch failure', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(
        Object.assign(new Error('Internal Server Error'), {
          type: 'server',
          status: 500,
          isRetryable: true,
        })
      )

      await expect(fetchRegressionsTags()).rejects.toThrow(
        'Internal Server Error'
      )
    })

    it('throws error on network failure', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(
        Object.assign(new Error('Network error'), {
          type: 'network',
          isRetryable: true,
        })
      )

      await expect(fetchRegressionsTags()).rejects.toThrow('Network error')
    })

    it('handles response with meta field', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: ['quarterly', 'weekly'],
        meta: { requestId: 'test-123' },
        status: 200,
      })

      const result = await fetchRegressionsTags()

      expect(result).toEqual(['quarterly', 'weekly'])
    })
  })
})
