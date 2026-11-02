/**
 * Regressions CRUD API Tests
 *
 * Covers the non-tag operations in `@/features/regressions/api/crud`:
 * - fetchRegressionDetail (which internally calls transformRegressionSuite)
 * - createRegression
 * - updateRegression
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
import {
  fetchRegressionDetail,
  createRegression,
  updateRegression,
  deleteRegression,
} from '@/features/regressions/api/crud'
import type {
  RegressionDetailApiResponse,
  RegressionSuiteApiResponse,
} from '@/features/regressions/api/types'

const mockDetail: RegressionDetailApiResponse = {
  id: 'reg-1',
  name: 'WAVE 26.04',
  description: 'Full release regression',
  created_at: '2026-03-01T00:00:00Z',
  updated_at: '2026-03-15T12:00:00Z',
  suites: ['suite-1', 'suite-2'],
  suites_count: 2,
  tests_count: 45,
  status: 'passed',
  last_run: '2026-03-15T12:00:00Z',
  tags: ['release'],
  variables: {},
}

const mockSuites: RegressionSuiteApiResponse[] = [
  {
    id: 'suite-1',
    name: 'Auth Suite',
    description: 'Authentication tests',
    status: 'passed',
    last_run: '2026-03-15T12:00:00Z',
    tags: ['auth'],
    tests_count: 25,
    avg_duration: 45.2,
    created_at: '2026-03-01T00:00:00Z',
    updated_at: '2026-03-15T12:00:00Z',
  },
  {
    id: 'suite-2',
    name: 'API Suite',
    // Legacy rows that omit optional fields exercise the nullish fallbacks
    // inside transformRegressionSuite (last_run, tags, avg_duration).
    description: null,
    status: 'never_run',
    last_run: null,
    tags: [],
    tests_count: 0,
    avg_duration: null,
    created_at: '2026-03-02T00:00:00Z',
    updated_at: '2026-03-02T00:00:00Z',
  },
]

describe('Regressions CRUD API', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('fetchRegressionDetail', () => {
    it('loads regression metadata and suites via Promise.all', async () => {
      vi.mocked(apiClient.get)
        .mockResolvedValueOnce({
          data: mockDetail,
          meta: { requestId: '' },
          status: 200,
        })
        .mockResolvedValueOnce({
          data: mockSuites,
          meta: { requestId: '' },
          status: 200,
        })

      const result = await fetchRegressionDetail('reg-1')

      expect(apiClient.get).toHaveBeenNthCalledWith(1, '/regressions/reg-1')
      expect(apiClient.get).toHaveBeenNthCalledWith(2, '/regressions/reg-1/suites')

      expect(result.regression.id).toBe('reg-1')
      expect(result.regression.name).toBe('WAVE 26.04')
      expect(result.regression.suiteIds).toEqual(['suite-1', 'suite-2'])
      expect(result.regression.suitesCount).toBe(2)
      expect(result.regression.testsCount).toBe(45)

      // transformRegressionSuite should produce camelCase fields
      expect(result.suites).toHaveLength(2)
      expect(result.suites[0].id).toBe('suite-1')
      expect(result.suites[0].name).toBe('Auth Suite')
      expect(result.suites[0].avgDuration).toBe(45.2)
      expect(result.suites[0].testsCount).toBe(25)
      expect(result.suites[0].lastRun).toBe('2026-03-15T12:00:00Z')

      // Second suite hits the nullish fallback branches
      expect(result.suites[1].lastRun).toBeNull()
      expect(result.suites[1].avgDuration).toBeNull()
      expect(result.suites[1].tags).toEqual([])
    })
  })

  describe('createRegression', () => {
    it('POSTs to /regressions and transforms the response', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: mockDetail,
        meta: { requestId: '' },
        status: 201,
      })

      const result = await createRegression({
        name: 'WAVE 26.04',
        description: 'Full release regression',
        tags: ['release'],
      })

      expect(apiClient.post).toHaveBeenCalledWith('/regressions', {
        name: 'WAVE 26.04',
        description: 'Full release regression',
        tags: ['release'],
      })
      expect(result.id).toBe('reg-1')
      expect(result.name).toBe('WAVE 26.04')
      expect(result.tags).toEqual(['release'])
    })
  })

  describe('updateRegression', () => {
    it('PUTs to /regressions/:id and transforms the response', async () => {
      vi.mocked(apiClient.put).mockResolvedValue({
        data: mockDetail,
        meta: { requestId: '' },
        status: 200,
      })

      const result = await updateRegression('reg-1', {
        name: 'WAVE 26.04',
        description: 'Updated description',
      })

      expect(apiClient.put).toHaveBeenCalledWith('/regressions/reg-1', {
        name: 'WAVE 26.04',
        description: 'Updated description',
      })
      expect(result.id).toBe('reg-1')
      expect(result.description).toBe('Full release regression')
    })
  })

  describe('deleteRegression', () => {
    it('sends DELETE for /regressions/:id and resolves to void', async () => {
      vi.mocked(apiClient.delete).mockResolvedValue({
        data: undefined,
        meta: { requestId: '' },
        status: 204,
      })

      const result = await deleteRegression('reg-1')

      expect(apiClient.delete).toHaveBeenCalledWith('/regressions/reg-1')
      expect(result).toBeUndefined()
    })

    it('rejects when the underlying DELETE fails', async () => {
      vi.mocked(apiClient.delete).mockRejectedValue(
        Object.assign(new Error('Conflict'), { status: 409 }),
      )

      await expect(deleteRegression('reg-1')).rejects.toThrow('Conflict')
    })
  })
})
