/**
 * Suites API Client Tests
 *
 * Tests for suites API fetch functions including the fetchSuitesList
 * which supports pagination, filtering, and sorting.
 *
 * Key test: camelCase to snake_case conversion for sort fields
 * (e.g., testsCount -> tests_count, lastRun -> last_run)
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
  fetchSuites,
  fetchSuitesList,
  fetchSuiteTests,
  deleteSuite,
  cloneSuite,
  batchDeleteSuites,
  transformApiSuite,
  transformApiSuiteList,
  fetchSuiteVariables,
} from '@/features/suites/api/crud'
import type { SuiteApiResponse, SuiteListApiResponse } from '@/features/suites/api/types'

describe('Suites API', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-15T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('fetchSuitesList', () => {
    it('fetches suites list successfully', async () => {
      const mockData = [
        {
          id: 'suite-1',
          name: 'Login Suite',
          description: 'Tests for login flow',
          version: '1.0.0',
          created_at: '2025-01-10T10:00:00Z',
          updated_at: '2025-01-15T10:00:00Z',
          tests_count: 5,
          status: 'passed',
          last_run: '2025-01-15T09:00:00Z',
          tags: ['smoke', 'critical'],
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

      const result = await fetchSuitesList()

      expect(apiClient.get).toHaveBeenCalledWith('/suites')
      expect(result.success).toBe(true)
      expect(result.data).toHaveLength(1)
      expect(result.data[0].name).toBe('Login Suite')
    })

    it('includes page parameter when provided', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: [],
        meta: { requestId: '' },
        status: 200,
        pagination: {},
      })

      await fetchSuitesList({ page: 2 })

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

      await fetchSuitesList({ per_page: 25 })

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

      await fetchSuitesList({ search: 'Login' })

      expect(apiClient.get).toHaveBeenCalledWith(
        expect.stringContaining('search=Login')
      )
    })

    it('includes status filter when provided', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: [],
        meta: { requestId: '' },
        status: 200,
        pagination: {},
      })

      await fetchSuitesList({ status: ['passed', 'failed'] })

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

      await fetchSuitesList({ tags: ['smoke', 'critical'] })

      // Tags are sent as comma-separated (URL-encoded comma = %2C)
      expect(apiClient.get).toHaveBeenCalledWith(
        expect.stringContaining('tags=smoke%2Ccritical')
      )
    })

    it('passes camelCase sort fields directly to backend', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: [],
        meta: { requestId: '' },
        status: 200,
        pagination: {},
      })

      await fetchSuitesList({ sort_by: 'testsCount', sort_order: 'desc' })

      expect(apiClient.get).toHaveBeenCalledWith(
        expect.stringContaining('sort_by=testsCount')
      )
      expect(apiClient.get).toHaveBeenCalledWith(
        expect.stringContaining('sort_order=desc')
      )
    })

    it('passes through snake_case sort fields unchanged (name)', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: [],
        meta: { requestId: '' },
        status: 200,
        pagination: {},
      })

      await fetchSuitesList({ sort_by: 'name', sort_order: 'asc' })

      expect(apiClient.get).toHaveBeenCalledWith(
        expect.stringContaining('sort_by=name')
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

      await expect(fetchSuitesList()).rejects.toThrow(
        'Internal Server Error'
      )
    })

    it('ignores empty status array', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: [],
        meta: { requestId: '' },
        status: 200,
        pagination: {},
      })

      await fetchSuitesList({ status: [] })

      expect(apiClient.get).toHaveBeenCalledWith(
        expect.not.stringContaining('status=')
      )
    })
  })

  describe('deleteSuite', () => {
    it('deletes suite successfully', async () => {
      vi.mocked(apiClient.delete).mockResolvedValue({
        data: null,
        meta: { requestId: '' },
        status: 204,
      })

      await deleteSuite('suite-123')

      expect(apiClient.delete).toHaveBeenCalledWith('/suites/suite-123')
    })

    it('throws error on non-OK response', async () => {
      vi.mocked(apiClient.delete).mockRejectedValue(
        Object.assign(new Error('Not Found'), {
          type: 'not_found',
          status: 404,
          isRetryable: false,
        })
      )

      await expect(deleteSuite('invalid-id')).rejects.toThrow(
        'Not Found'
      )
    })
  })

  describe('cloneSuite', () => {
    it('clones suite successfully', async () => {
      const mockData = {
        id: 'suite-456',
        name: 'Login Suite (Copy)',
        description: 'Tests for login flow',
        version: '1.0.0',
        created_at: '2025-01-15T12:00:00Z',
        updated_at: '2025-01-15T12:00:00Z',
        tests_count: 5,
        status: 'never_run',
        last_run: null,
        tags: ['smoke', 'critical'],
      }

      vi.mocked(apiClient.post).mockResolvedValue({
        data: mockData,
        meta: { requestId: '' },
        status: 201,
      })

      const result = await cloneSuite('suite-123', 'Login Suite')

      expect(apiClient.post).toHaveBeenCalledWith(
        '/suites/suite-123/clone',
        { new_name: 'Login Suite (Copy)' }
      )
      expect(result.id).toBe('suite-456')
    })

    it('throws error on non-OK response with error message', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(
        Object.assign(new Error('Suite already exists'), {
          type: 'conflict',
          status: 409,
          isRetryable: false,
        })
      )

      await expect(cloneSuite('suite-123', 'Login Suite')).rejects.toThrow(
        'Suite already exists'
      )
    })

    it('throws error on non-OK response without error message', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(
        Object.assign(new Error('Bad Request'), {
          type: 'client',
          status: 400,
          isRetryable: false,
        })
      )

      await expect(cloneSuite('suite-123', 'Login Suite')).rejects.toThrow(
        'Bad Request'
      )
    })

    it('generates default name when suiteName is not provided', async () => {
      const mockData = {
        id: 'suite-456',
        name: 'Suite (Copy)',
        description: 'Tests for login flow',
        version: '1.0.0',
        created_at: '2025-01-15T12:00:00Z',
        updated_at: '2025-01-15T12:00:00Z',
        tests_count: 5,
        status: 'never_run',
        last_run: null,
        tags: [],
      }

      vi.mocked(apiClient.post).mockResolvedValue({
        data: mockData,
        meta: { requestId: '' },
        status: 201,
      })

      // Call without suiteName to trigger the else branch
      await cloneSuite('suite-123')

      expect(apiClient.post).toHaveBeenCalledWith(
        '/suites/suite-123/clone',
        expect.objectContaining({
          new_name: expect.stringMatching(/Suite \(Copy\) \d+/),
        })
      )
    })
  })

  describe('batchDeleteSuites', () => {
    it('batch deletes suites successfully', async () => {
      const mockResponse = {
        deleted: ['suite-1', 'suite-2'],
        failed: [],
      }

      vi.mocked(apiClient.delete).mockResolvedValue({
        data: mockResponse,
        meta: { requestId: '' },
        status: 200,
      })

      const result = await batchDeleteSuites(['suite-1', 'suite-2'])

      expect(apiClient.delete).toHaveBeenCalledWith(
        '/suites/batch',
        ['suite-1', 'suite-2'],
        { rawResponse: true }
      )
      expect(result.deleted).toEqual(['suite-1', 'suite-2'])
      expect(result.failed).toEqual([])
    })

    it('throws error on non-OK response', async () => {
      vi.mocked(apiClient.delete).mockRejectedValue(
        Object.assign(new Error('Internal Server Error'), { type: 'server', status: 500, isRetryable: false })
      )

      await expect(batchDeleteSuites(['suite-1'])).rejects.toThrow(
        'Internal Server Error'
      )
    })

    it('throws error with specific message from backend detail', async () => {
      vi.mocked(apiClient.delete).mockRejectedValue(
        Object.assign(new Error('Some suites are in use'), { type: 'client', status: 400, isRetryable: false })
      )

      await expect(batchDeleteSuites(['suite-1'])).rejects.toThrow(
        'Some suites are in use'
      )
    })
  })

  describe('fetchSuites', () => {
    it('fetches suites successfully', async () => {
      const mockData = [{ id: 'suite-1', name: 'Suite One', version: '1.0.0' }]

      vi.mocked(apiClient.get).mockResolvedValue({
        data: mockData,
        meta: { requestId: '' },
        status: 200,
      })

      const result = await fetchSuites()

      expect(apiClient.get).toHaveBeenCalledWith('/suites')
      expect(result).toEqual({ success: true, data: mockData })
    })

    it('throws error on fetch failure', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(
        Object.assign(new Error('Service Unavailable'), {
          type: 'server',
          status: 503,
          isRetryable: true,
        })
      )

      await expect(fetchSuites()).rejects.toThrow('Service Unavailable')
    })
  })

  describe('transformApiSuite', () => {
    it('transforms suite correctly', () => {
      const apiSuite: SuiteApiResponse = {
        id: 'suite-1',
        name: 'Authentication Suite',
        version: '2.0.0',
      }

      const result = transformApiSuite(apiSuite)

      expect(result.id).toBe('suite-1')
      expect(result.name).toBe('Authentication Suite')
    })
  })

  describe('transformApiSuiteList', () => {
    it('transforms suite list item with all fields', () => {
      const apiSuite: SuiteListApiResponse = {
        id: 'suite-1',
        name: 'Test Suite',
        description: 'A test suite',
        version: '1.0.0',
        tests_count: 10,
        status: 'passed',
        last_run: '2025-01-15T12:00:00Z',
        tags: ['tag1', 'tag2'],
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-15T12:00:00Z',
      }

      const result = transformApiSuiteList(apiSuite)

      expect(result.id).toBe('suite-1')
      expect(result.name).toBe('Test Suite')
      expect(result.description).toBe('A test suite')
      expect(result.testsCount).toBe(10)
      expect(result.status).toBe('passed')
      expect(result.lastRun).toBe('2025-01-15T12:00:00Z')
      expect(result.tags).toEqual(['tag1', 'tag2'])
      expect(result.createdAt).toBe('2025-01-01T00:00:00Z')
      expect(result.updatedAt).toBe('2025-01-15T12:00:00Z')
    })

    it('transforms suite list item with missing optional fields', () => {
      const apiSuite = {
        id: 'suite-2',
        name: 'Minimal Suite',
        tests_count: 0,
        status: 'never_run',
      } as SuiteListApiResponse

      const result = transformApiSuiteList(apiSuite)

      expect(result.id).toBe('suite-2')
      expect(result.name).toBe('Minimal Suite')
      expect(result.description).toBeNull()
      expect(result.testsCount).toBe(0)
      expect(result.status).toBe('never_run')
      expect(result.lastRun).toBeNull()
      expect(result.tags).toEqual([])
      expect(result.createdAt).toBeNull()
      expect(result.updatedAt).toBeNull()
    })
  })

  describe('fetchSuiteTests', () => {
    it('fetches tests for a suite', async () => {
      const mockData = [
        { id: 'test-1', name: 'Test One' },
        { id: 'test-2', name: 'Test Two' },
      ]

      vi.mocked(apiClient.get).mockResolvedValue({
        data: mockData,
        meta: { requestId: '' },
        status: 200,
      })

      const result = await fetchSuiteTests('suite-123')

      expect(apiClient.get).toHaveBeenCalledWith('/suites/suite-123/tests')
      expect(result).toHaveLength(2)
      expect(result[0].name).toBe('Test One')
      expect(result[1].name).toBe('Test Two')
    })

    it('throws error on non-OK response', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(
        Object.assign(new Error('Not Found'), {
          type: 'not_found',
          status: 404,
          isRetryable: false,
        })
      )

      await expect(fetchSuiteTests('invalid-suite')).rejects.toThrow(
        'Not Found'
      )
    })
  })

  // ===========================================================================
  // Suite Composition API
  // ===========================================================================

  describe('addTestToSuite', () => {
    it('posts test to suite composition endpoint', async () => {
      const { addTestToSuite } = await import('@/features/suites/api/crud')
      vi.mocked(apiClient.post).mockResolvedValueOnce({ data: {}, meta: { requestId: '' }, status: 200 })

      await addTestToSuite('suite-1', 'test-1')

      expect(apiClient.post).toHaveBeenCalledWith(
        '/suites/suite-1/tests',
        { test_id: 'test-1' }
      )
    })
  })

  describe('removeTestFromSuite', () => {
    it('deletes test from suite composition endpoint', async () => {
      const { removeTestFromSuite } = await import('@/features/suites/api/crud')
      vi.mocked(apiClient.delete).mockResolvedValueOnce({ data: {}, meta: { requestId: '' }, status: 200 })

      await removeTestFromSuite('suite-1', 'test-1')

      expect(apiClient.delete).toHaveBeenCalledWith(
        '/suites/suite-1/tests/test-1'
      )
    })
  })

  describe('fetchSuiteVariables', () => {
    it('fetches variables for a suite', async () => {
      const mockVars = {
        BASE_URL: { type: 'string', value: 'https://api.example.com' },
        TIMEOUT: { type: 'number', value: 30 },
      }

      vi.mocked(apiClient.get).mockResolvedValue({
        data: mockVars,
        meta: { requestId: '' },
        status: 200,
      })

      const result = await fetchSuiteVariables('suite-123')

      expect(apiClient.get).toHaveBeenCalledWith('/suites/suite-123/variables')
      expect(result).toEqual(mockVars)
    })

    it('throws error on non-OK response', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(
        Object.assign(new Error('Not Found'), {
          type: 'not_found',
          status: 404,
          isRetryable: false,
        })
      )

      await expect(fetchSuiteVariables('invalid-suite')).rejects.toThrow(
        'Not Found'
      )
    })
  })
})
