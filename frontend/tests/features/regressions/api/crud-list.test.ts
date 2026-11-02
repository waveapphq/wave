/**
 * Regressions API Client Tests
 *
 * REQ-5.2.1.37: Regression management screen (list, create, edit, version control)
 *
 * Tests for regressions API fetch and transformation functions.
 * Backend API is fully implemented - this tests the frontend API client.
 *
 * API endpoints covered:
 * - GET /regressions - List with pagination and search
 * - GET /regressions/{id} - Get by ID
 * - DELETE /regressions/{id} - Delete
 * - POST /regressions/{id}/clone - Duplicate
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
  fetchRegressions,
  fetchRegression,
  deleteRegression,
  batchDeleteRegressions,
  batchCloneRegressions,
  cloneRegression,
  fetchRegressionSuitesWithTests,
  transformApiRegression,
} from '@/features/regressions/api/crud'
import type { RegressionApiResponse } from '@/features/regressions/api/types'

describe('Regressions API', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-15T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('fetchRegressions', () => {
    it('fetches regressions list successfully', async () => {
      const mockData = [
        {
          id: 'reg-1',
          name: 'WAVE 25.12',
          description: 'Full regression for WAVE 25.12 release',
  
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-15T10:00:00Z',
          suites_count: 5,
          tests_count: 150,
          status: 'passed',
          last_run: '2025-01-15T09:00:00Z',
          tags: ['release', 'full'],
        },
      ]

      vi.mocked(apiClient.get).mockResolvedValue({
        data: mockData,
        meta: { requestId: '' },
        status: 200,
        pagination: {
          total: 1,
          page: 1,
          per_page: 10,
          total_pages: 1,
        },
      })

      const result = await fetchRegressions()

      expect(apiClient.get).toHaveBeenCalledWith('/regressions')
      expect(result.success).toBe(true)
      expect(result.data).toHaveLength(1)
      expect(result.data[0].name).toBe('WAVE 25.12')
    })

    it('includes page parameter when provided', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: [],
        meta: { requestId: '' },
        status: 200,
        pagination: {},
      })

      await fetchRegressions({ page: 2 })

      expect(apiClient.get).toHaveBeenCalledWith(
        expect.stringContaining('page=2')
      )
    })

    it('includes per_page parameter when provided', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: [],
        meta: { requestId: '' },
        status: 200,
        pagination: {},
      })

      await fetchRegressions({ per_page: 25 })

      expect(apiClient.get).toHaveBeenCalledWith(
        expect.stringContaining('per_page=25')
      )
    })

    it('includes search parameter when provided', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: [],
        meta: { requestId: '' },
        status: 200,
        pagination: {},
      })

      await fetchRegressions({ search: 'WAVE' })

      expect(apiClient.get).toHaveBeenCalledWith(
        expect.stringContaining('search=WAVE')
      )
    })

    it('includes status filter when provided', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: [],
        meta: { requestId: '' },
        status: 200,
        pagination: {},
      })

      await fetchRegressions({ status: ['passed', 'failed'] })

      expect(apiClient.get).toHaveBeenCalledWith(
        expect.stringContaining('status=passed%2Cfailed')
      )
    })

    it('includes tags filter when provided', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: [],
        meta: { requestId: '' },
        status: 200,
        pagination: {},
      })

      await fetchRegressions({ tags: ['release'] })

      expect(apiClient.get).toHaveBeenCalledWith(
        expect.stringContaining('tags=release')
      )
    })

    it('includes sort parameters when provided', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: [],
        meta: { requestId: '' },
        status: 200,
        pagination: {},
      })

      await fetchRegressions({ sort_by: 'name', sort_order: 'asc' })

      expect(apiClient.get).toHaveBeenCalledWith(
        expect.stringContaining('sort_by=name')
      )
      expect(apiClient.get).toHaveBeenCalledWith(
        expect.stringContaining('sort_order=asc')
      )
    })

    it('includes sort_by without sort_order', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: [],
        meta: { requestId: '' },
        status: 200,
        pagination: {},
      })

      await fetchRegressions({ sort_by: 'name' })

      expect(apiClient.get).toHaveBeenCalledWith(
        expect.stringContaining('sort_by=name')
      )
      expect(apiClient.get).not.toHaveBeenCalledWith(
        expect.stringContaining('sort_order=')
      )
    })

    it('converts camelCase sort fields to snake_case (testsCount -> tests_count)', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: [],
        meta: { requestId: '' },
        status: 200,
        pagination: {},
      })

      await fetchRegressions({ sort_by: 'testsCount', sort_order: 'desc' })

      expect(apiClient.get).toHaveBeenCalledWith(
        expect.stringContaining('sort_by=tests_count')
      )
      expect(apiClient.get).toHaveBeenCalledWith(
        expect.stringContaining('sort_order=desc')
      )
    })

    it('converts camelCase sort fields to snake_case (suitesCount -> suites_count)', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: [],
        meta: { requestId: '' },
        status: 200,
        pagination: {},
      })

      await fetchRegressions({ sort_by: 'suitesCount', sort_order: 'asc' })

      expect(apiClient.get).toHaveBeenCalledWith(
        expect.stringContaining('sort_by=suites_count')
      )
      expect(apiClient.get).toHaveBeenCalledWith(
        expect.stringContaining('sort_order=asc')
      )
    })

    it('converts camelCase sort fields to snake_case (lastRun -> last_run)', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: [],
        meta: { requestId: '' },
        status: 200,
        pagination: {},
      })

      await fetchRegressions({ sort_by: 'lastRun', sort_order: 'desc' })

      expect(apiClient.get).toHaveBeenCalledWith(
        expect.stringContaining('sort_by=last_run')
      )
      expect(apiClient.get).toHaveBeenCalledWith(
        expect.stringContaining('sort_order=desc')
      )
    })

    it('converts camelCase sort fields to snake_case (createdAt -> created_at)', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: [],
        meta: { requestId: '' },
        status: 200,
        pagination: {},
      })

      await fetchRegressions({ sort_by: 'createdAt', sort_order: 'asc' })

      expect(apiClient.get).toHaveBeenCalledWith(
        expect.stringContaining('sort_by=created_at')
      )
      expect(apiClient.get).toHaveBeenCalledWith(
        expect.stringContaining('sort_order=asc')
      )
    })

    it('throws error on non-OK response', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(
        Object.assign(new Error('Internal Server Error'), {
          type: 'server',
          status: 500,
          isRetryable: true,
        })
      )

      await expect(fetchRegressions()).rejects.toThrow(
        'Internal Server Error'
      )
    })
  })

  describe('fetchRegression', () => {
    it('fetches single regression by ID', async () => {
      const mockData = {
        id: 'reg-123',
        name: 'WAVE 25.12',
        description: 'Full regression',

        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-15T10:00:00Z',
        suites_count: 5,
        tests_count: 150,
        status: 'passed',
        last_run: '2025-01-15T09:00:00Z',
        tags: ['release'],
      }

      vi.mocked(apiClient.get).mockResolvedValue({
        data: mockData,
        meta: { requestId: '' },
        status: 200,
      })

      const result = await fetchRegression('reg-123')

      expect(apiClient.get).toHaveBeenCalledWith('/regressions/reg-123')
      expect(result.success).toBe(true)
      expect(result.data.id).toBe('reg-123')
    })

    it('throws error on non-OK response', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(
        Object.assign(new Error('Not Found'), {
          type: 'not_found',
          status: 404,
          isRetryable: false,
        })
      )

      await expect(fetchRegression('invalid-id')).rejects.toThrow(
        'Not Found'
      )
    })
  })

  describe('deleteRegression', () => {
    it('deletes regression successfully', async () => {
      vi.mocked(apiClient.delete).mockResolvedValue({
        data: null,
        meta: { requestId: '' },
        status: 204,
      })

      await deleteRegression('reg-123')

      expect(apiClient.delete).toHaveBeenCalledWith('/regressions/reg-123')
    })

    it('throws error on non-OK response', async () => {
      vi.mocked(apiClient.delete).mockRejectedValue(
        Object.assign(new Error('Conflict'), {
          type: 'conflict',
          status: 409,
          isRetryable: false,
        })
      )

      await expect(deleteRegression('reg-123')).rejects.toThrow(
        'Conflict'
      )
    })
  })

  describe('batchDeleteRegressions', () => {
    it('sends DELETE /regressions/batch with the id list', async () => {
      const body = {
        deleted: ['reg-1', 'reg-2'],
        failed: [],
      }
      vi.mocked(apiClient.delete).mockResolvedValue({
        data: body,
        meta: { requestId: '' },
        status: 200,
      })

      const result = await batchDeleteRegressions(['reg-1', 'reg-2'])

      expect(apiClient.delete).toHaveBeenCalledWith(
        '/regressions/batch',
        ['reg-1', 'reg-2'],
        { rawResponse: true },
      )
      expect(result).toEqual(body)
    })
  })

  describe('batchCloneRegressions', () => {
    it('sends POST /regressions/batch/clone with the id list', async () => {
      const body = {
        cloned: [
          { original_id: 'reg-1', cloned_id: 'reg-1-copy' },
          { original_id: 'reg-2', cloned_id: 'reg-2-copy' },
        ],
        failed: [],
      }
      vi.mocked(apiClient.post).mockResolvedValue({
        data: body,
        meta: { requestId: '' },
        status: 200,
      })

      const result = await batchCloneRegressions(['reg-1', 'reg-2'])

      expect(apiClient.post).toHaveBeenCalledWith(
        '/regressions/batch/clone',
        ['reg-1', 'reg-2'],
        { rawResponse: true },
      )
      expect(result).toEqual(body)
    })
  })

  describe('cloneRegression', () => {
    it('clones regression successfully', async () => {
      const mockData = {
        id: 'reg-456',
        name: 'WAVE 25.12 (Copy)',
        description: 'Full regression',

        created_at: '2025-01-15T12:00:00Z',
        updated_at: '2025-01-15T12:00:00Z',
        suites_count: 5,
        tests_count: 150,
        status: 'never_run',
        last_run: null,
        tags: ['release'],
      }

      vi.mocked(apiClient.post).mockResolvedValue({
        data: mockData,
        meta: { requestId: '' },
        status: 201,
      })

      const result = await cloneRegression('reg-123', 'WAVE 25.12')

      expect(apiClient.post).toHaveBeenCalledWith(
        '/regressions/reg-123/clone',
        { name: 'WAVE 25.12 (Copy)' }
      )
      expect(result.id).toBe('reg-456')
    })

    it('generates name with timestamp if original name not provided', async () => {
      const mockData = {
        id: 'reg-456',
        name: 'Regression (Copy) 1736942400000',

        created_at: '2025-01-15T12:00:00Z',
        updated_at: '2025-01-15T12:00:00Z',
        suites_count: 0,
        tests_count: 0,
        status: 'never_run',
        last_run: null,
        tags: [],
      }

      vi.mocked(apiClient.post).mockResolvedValue({
        data: mockData,
        meta: { requestId: '' },
        status: 201,
      })

      await cloneRegression('reg-123')

      expect(apiClient.post).toHaveBeenCalledWith(
        '/regressions/reg-123/clone',
        expect.objectContaining({
          name: expect.stringContaining('Regression (Copy)'),
        })
      )
    })

    it('throws error on non-OK response', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(
        Object.assign(new Error('Clone failed'), {
          type: 'server',
          status: 500,
          isRetryable: true,
        })
      )

      await expect(cloneRegression('reg-123')).rejects.toThrow(
        'Clone failed'
      )
    })

    it('uses statusText when error message not in response', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(
        Object.assign(new Error('Internal Server Error'), {
          type: 'server',
          status: 500,
          isRetryable: true,
        })
      )

      await expect(cloneRegression('reg-123')).rejects.toThrow(
        'Internal Server Error'
      )
    })
  })

  describe('fetchRegressionSuitesWithTests', () => {
    it('fetches suites with tests for a regression', async () => {
      const mockData = [
        {
          id: 'suite-1',
          name: 'Login Tests',
          tests: [
            { id: 'test-1', name: 'Valid login' },
            { id: 'test-2', name: 'Invalid login' },
          ],
        },
        {
          id: 'suite-2',
          name: 'Checkout Tests',
          tests: [{ id: 'test-3', name: 'Complete checkout' }],
        },
      ]

      vi.mocked(apiClient.get).mockResolvedValue({
        data: mockData,
        meta: { requestId: '' },
        status: 200,
      })

      const result = await fetchRegressionSuitesWithTests('reg-123')

      expect(apiClient.get).toHaveBeenCalledWith('/regressions/reg-123/suites')
      expect(result).toHaveLength(2)
      expect(result[0].name).toBe('Login Tests')
      expect(result[0].tests).toHaveLength(2)
      expect(result[1].name).toBe('Checkout Tests')
      expect(result[1].tests).toHaveLength(1)
    })

    it('throws error on non-OK response', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(
        Object.assign(new Error('Not Found'), {
          type: 'not_found',
          status: 404,
          isRetryable: false,
        })
      )

      await expect(fetchRegressionSuitesWithTests('invalid-id')).rejects.toThrow(
        'Not Found'
      )
    })
  })

  describe('transformApiRegression', () => {
    it('transforms API response to Regression type', () => {
      const apiRegression: RegressionApiResponse = {
        id: 'reg-1',
        name: 'WAVE 25.12',
        description: "Full regression for release",
        version: "1.0.0",

        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-15T10:00:00Z',
        suites_count: 5,
        tests_count: 150,
        status: 'passed',
        last_run: '2025-01-15T09:00:00Z',
        tags: ['release', 'full'],
      }

      const result = transformApiRegression(apiRegression)

      expect(result.id).toBe('reg-1')
      expect(result.name).toBe('WAVE 25.12')
      expect(result.description).toBe('Full regression for release')
      expect(result.suitesCount).toBe(5)
      expect(result.testsCount).toBe(150)
      expect(result.status).toBe('passed')
      expect(result.lastRun).toBe('2025-01-15T09:00:00Z')
      expect(result.tags).toEqual(['release', 'full'])
      expect(result.createdAt).toBe('2025-01-01T00:00:00Z')
      expect(result.updatedAt).toBe('2025-01-15T10:00:00Z')
    })

    it('handles null description', () => {
      const apiRegression: RegressionApiResponse = {
        id: 'reg-1',
        name: 'Regression',
        description: null,
        version: "1.0.0",

        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
        suites_count: 0,
        tests_count: 0,
        status: 'never_run',
        last_run: null,
        tags: [],
      }

      const result = transformApiRegression(apiRegression)

      expect(result.description).toBeNull()
    })

    it('handles null last_run', () => {
      const apiRegression: RegressionApiResponse = {
        id: 'reg-1',
        name: 'Regression',
        description: null,
        version: "1.0.0",

        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
        suites_count: 0,
        tests_count: 0,
        status: 'never_run',
        last_run: null,
        tags: [],
      }

      const result = transformApiRegression(apiRegression)

      expect(result.lastRun).toBeNull()
    })

    it('handles empty tags array', () => {
      const apiRegression: RegressionApiResponse = {
        id: 'reg-1',
        name: 'Regression',
        description: null,
        version: "1.0.0",

        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
        suites_count: 0,
        tests_count: 0,
        status: 'never_run',
        last_run: null,
        tags: [],
      }

      const result = transformApiRegression(apiRegression)

      expect(result.tags).toEqual([])
    })

    it('handles empty tags', () => {
      const apiRegression: RegressionApiResponse = {
        id: 'reg-1',
        name: 'Regression',
        description: null,
        version: "1.0.0",

        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
        suites_count: 0,
        tests_count: 0,
        status: 'never_run',
        last_run: null,
        tags: [],
      }

      const result = transformApiRegression(apiRegression)

      expect(result.tags).toEqual([])
    })

    it('handles zero suites_count', () => {
      const apiRegression: RegressionApiResponse = {
        id: 'reg-1',
        name: 'Empty Regression',
        description: null,
        version: "1.0.0",

        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
        suites_count: 0,
        tests_count: 0,
        status: 'never_run',
        last_run: null,
        tags: [],
      }

      const result = transformApiRegression(apiRegression)

      expect(result.suitesCount).toBe(0)
      expect(result.testsCount).toBe(0)
    })

    it('handles all three status values', () => {
      const passed: RegressionApiResponse = {
        id: 'reg-1',
        name: 'Passed',
        description: null,
        version: "1.0.0",

        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
        suites_count: 1,
        tests_count: 10,
        status: 'passed',
        last_run: '2025-01-15T09:00:00Z',
        tags: [],
      }

      const failed: RegressionApiResponse = {
        ...passed,
        id: 'reg-2',
        name: 'Failed',
        status: 'failed',
      }

      const neverRun: RegressionApiResponse = {
        ...passed,
        id: 'reg-3',
        name: 'Never Run',
        status: 'never_run',
        last_run: null,
      }

      expect(transformApiRegression(passed).status).toBe('passed')
      expect(transformApiRegression(failed).status).toBe('failed')
      expect(transformApiRegression(neverRun).status).toBe('never_run')
    })
  })
})
