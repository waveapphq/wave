/**
 * Suites Tags and Names API Client Tests
 *
 * REQ-9.5.3.2: GET /suites/tags - Return unique tags across all suites
 * REQ-9.5.3.5: GET /suites/names - Return all suites with minimal data for dropdowns
 *
 * Tests for the suites tags and names fetch functions.
 * These endpoints return data for filter dropdowns and selection UI.
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

import { fetchSuitesTags, fetchSuiteNames } from '@/features/suites/api/crud'

// ============================================================================
// Suites Tags API Tests (REQ-9.5.3.2)
// ============================================================================

describe('Suites Tags API', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('fetchSuitesTags', () => {
    it('fetches all unique tags from suites successfully', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: ['authentication', 'checkout', 'payment', 'user-management'],
        meta: { requestId: '' },
        status: 200,
      })

      const result = await fetchSuitesTags()

      expect(apiClient.get).toHaveBeenCalledWith('/suites/tags')
      expect(result).toEqual(['authentication', 'checkout', 'payment', 'user-management'])
    })

    it('returns empty array when no suites have tags', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: [],
        meta: { requestId: '' },
        status: 200,
      })

      const result = await fetchSuitesTags()

      expect(result).toEqual([])
    })

    it('preserves tag order from backend (sorted alphabetically)', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: ['api', 'database', 'frontend', 'integration'],
        meta: { requestId: '' },
        status: 200,
      })

      const result = await fetchSuitesTags()

      // Backend returns sorted, we preserve that order
      expect(result).toEqual(['api', 'database', 'frontend', 'integration'])
    })

    it('throws error on 503 service unavailable', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(
        Object.assign(new Error('Service Unavailable'), {
          type: 'server',
          status: 503,
          isRetryable: true,
        })
      )

      await expect(fetchSuitesTags()).rejects.toThrow(
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

      await expect(fetchSuitesTags()).rejects.toThrow(
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

      await expect(fetchSuitesTags()).rejects.toThrow('Network error')
    })

    it('handles response with meta field', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: ['e2e', 'unit'],
        meta: { requestId: 'test-123' },
        status: 200,
      })

      const result = await fetchSuitesTags()

      expect(result).toEqual(['e2e', 'unit'])
    })
  })
})

// ============================================================================
// Suite Names API Tests (REQ-9.5.3.5)
// ============================================================================

describe('Suite Names API', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('fetchSuiteNames', () => {
    it('fetches all suites with minimal data successfully', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: [
          { id: 'suite-1', name: 'Authentication Suite' },
          { id: 'suite-2', name: 'Checkout Suite' },
          { id: 'suite-3', name: 'Payment Suite' },
        ],
        meta: { requestId: '' },
        status: 200,
      })

      const result = await fetchSuiteNames()

      expect(apiClient.get).toHaveBeenCalledWith('/suites/names')
      expect(result).toHaveLength(3)
      expect(result[0]).toEqual({ id: 'suite-1', name: 'Authentication Suite' })
    })

    it('returns only id and name fields', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: [{ id: 'suite-1', name: 'Login Suite' }],
        meta: { requestId: '' },
        status: 200,
      })

      const result = await fetchSuiteNames()

      expect(result).toHaveLength(1)
      const suite = result[0]
      expect(Object.keys(suite).sort()).toEqual(['id', 'name'])
    })

    it('returns empty array when no suites exist', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: [],
        meta: { requestId: '' },
        status: 200,
      })

      const result = await fetchSuiteNames()

      expect(result).toEqual([])
    })

    it('preserves order from backend (sorted by name)', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: [
          { id: 'suite-1', name: 'Alpha Suite' },
          { id: 'suite-2', name: 'Beta Suite' },
          { id: 'suite-3', name: 'Gamma Suite' },
        ],
        meta: { requestId: '' },
        status: 200,
      })

      const result = await fetchSuiteNames()

      const names = result.map((s: { name: string }) => s.name)
      expect(names).toEqual(['Alpha Suite', 'Beta Suite', 'Gamma Suite'])
    })

    it('throws error on 503 service unavailable', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(
        Object.assign(new Error('Service Unavailable'), {
          type: 'server',
          status: 503,
          isRetryable: true,
        })
      )

      await expect(fetchSuiteNames()).rejects.toThrow(
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

      await expect(fetchSuiteNames()).rejects.toThrow(
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

      await expect(fetchSuiteNames()).rejects.toThrow('Network error')
    })
  })
})
