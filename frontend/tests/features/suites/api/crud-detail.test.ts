/**
 * Suite Detail API Tests
 *
 * Tests for createSuite, fetchSuiteDetail, updateSuite, and transformSuiteDetail.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'

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
  createSuite,
  fetchSuiteDetail,
  updateSuite,
  transformSuiteDetail,
} from '@/features/suites/api/crud'
import type { SuiteDetailApiResponse } from '@/features/suites/api/types'

const mockGet = vi.mocked(apiClient.get)
const mockPost = vi.mocked(apiClient.post)
const mockPut = vi.mocked(apiClient.put)

/** Wrap data in an ApiResponse shape for mocks */
function mockResponse<T>(data: T) {
  return { data, meta: { requestId: '' }, status: 200 }
}

function makeSuiteApiResponse(overrides?: Partial<SuiteDetailApiResponse>): SuiteDetailApiResponse {
  return {
    id: 'suite-1',
    name: 'Test Suite',
    description: 'A test suite',
    version: '1.0.0',
    created_at: '2026-03-01T00:00:00Z',
    updated_at: '2026-03-02T00:00:00Z',
    tests: ['test-1', 'test-2'],
    tests_count: 2,
    status: 'passed',
    last_run: '2026-03-02T12:00:00Z',
    tags: ['smoke', 'api'],
    variables: {
      base_url: { type: 'string', value: 'http://localhost', secret: false },
    },
    metadata: {},
    ...overrides,
  }
}

describe('Suite Detail API', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('transformSuiteDetail', () => {
    it('transforms snake_case API response to camelCase', () => {
      const api = makeSuiteApiResponse()
      const result = transformSuiteDetail(api)

      expect(result).toEqual({
        id: 'suite-1',
        name: 'Test Suite',
        description: 'A test suite',
        version: '1.0.0',
        createdAt: '2026-03-01T00:00:00Z',
        updatedAt: '2026-03-02T00:00:00Z',
        testIds: ['test-1', 'test-2'],
        testsCount: 2,
        status: 'passed',
        lastRun: '2026-03-02T12:00:00Z',
        tags: ['smoke', 'api'],
        variables: {
          base_url: { type: 'string', value: 'http://localhost', secret: false },
        },
      })
    })

    it('handles missing optional fields gracefully', () => {
      const api = makeSuiteApiResponse({
        description: null,
        tests: undefined as unknown as string[],
        last_run: null,
        tags: undefined as unknown as string[],
        variables: undefined as unknown as Record<string, never>,
      })

      const result = transformSuiteDetail(api)

      expect(result.description).toBeNull()
      expect(result.testIds).toEqual([])
      expect(result.lastRun).toBeNull()
      expect(result.tags).toEqual([])
      expect(result.variables).toEqual({})
    })
  })

  describe('createSuite', () => {
    it('sends POST to /suites and returns transformed detail', async () => {
      const suiteData = makeSuiteApiResponse({ id: 'new-suite-1', version: '1.0.0' })
      mockPost.mockResolvedValue(mockResponse(suiteData))

      const result = await createSuite({ name: 'New Suite', description: 'desc', tags: ['tag1'] })

      expect(mockPost).toHaveBeenCalledWith('/suites', {
        name: 'New Suite',
        description: 'desc',
        tags: ['tag1'],
      })
      expect(result.id).toBe('new-suite-1')
      expect(result.name).toBe('Test Suite')
    })

    it('sends minimal payload when only name provided', async () => {
      mockPost.mockResolvedValue(mockResponse(makeSuiteApiResponse()))

      await createSuite({ name: 'Minimal Suite' })

      expect(mockPost).toHaveBeenCalledWith('/suites', { name: 'Minimal Suite' })
    })

    it('propagates API errors', async () => {
      mockPost.mockRejectedValue(new Error('Validation failed'))

      await expect(createSuite({ name: '' })).rejects.toThrow('Validation failed')
    })
  })

  describe('fetchSuiteDetail', () => {
    it('fetches suite metadata and tests via Promise.all', async () => {
      const suiteApi = makeSuiteApiResponse()
      const testsApiData = [
        {
          id: 'test-1',
          name: 'Login Test',
          version: '1.0.0',
          created_at: '2026-03-01T00:00:00Z',
          updated_at: '2026-03-02T00:00:00Z',
          tags: ['smoke'],
          metadata: { status: 'passed', last_run: '2026-03-02T12:00:00Z' },
        },
        {
          id: 'test-2',
          name: 'Logout Test',
          version: '1.0.0',
          created_at: '2026-03-01T00:00:00Z',
          updated_at: '2026-03-01T00:00:00Z',
          tags: [],
          metadata: {},
        },
      ]

      mockGet.mockImplementation((path: string) => {
        if (path === '/suites/suite-1') {
          return Promise.resolve(mockResponse(suiteApi))
        }
        if (path === '/suites/suite-1/tests') {
          return Promise.resolve(mockResponse(testsApiData))
        }
        return Promise.reject(new Error(`Unexpected path: ${path}`))
      })

      const result = await fetchSuiteDetail('suite-1')

      expect(mockGet).toHaveBeenCalledTimes(2)
      expect(result.suite.id).toBe('suite-1')
      expect(result.suite.name).toBe('Test Suite')
      expect(result.tests).toEqual([
        { id: 'test-1', name: 'Login Test', status: 'passed', lastRun: '2026-03-02T12:00:00Z', tags: ['smoke'], createdAt: '2026-03-01T00:00:00Z', updatedAt: '2026-03-02T00:00:00Z' },
        { id: 'test-2', name: 'Logout Test', status: 'never_run', lastRun: null, tags: [], createdAt: '2026-03-01T00:00:00Z', updatedAt: '2026-03-01T00:00:00Z' },
      ])
    })

    it('propagates errors when suite not found', async () => {
      mockGet.mockRejectedValue(new Error('Not found'))

      await expect(fetchSuiteDetail('missing')).rejects.toThrow('Not found')
    })
  })

  describe('updateSuite', () => {
    it('sends PUT to /suites/{id} and returns transformed detail', async () => {
      const updated = makeSuiteApiResponse({ name: 'Updated Name', version: '1.0.1' })
      mockPut.mockResolvedValue(mockResponse(updated))

      const result = await updateSuite('suite-1', { name: 'Updated Name' })

      expect(mockPut).toHaveBeenCalledWith('/suites/suite-1', { name: 'Updated Name' })
      expect(result.name).toBe('Updated Name')
      expect(result.version).toBe('1.0.1')
    })

    it('sends partial update payload', async () => {
      mockPut.mockResolvedValue(mockResponse(makeSuiteApiResponse()))

      await updateSuite('suite-1', { tags: ['new-tag'] })

      expect(mockPut).toHaveBeenCalledWith('/suites/suite-1', { tags: ['new-tag'] })
    })

    it('propagates API errors', async () => {
      mockPut.mockRejectedValue(new Error('Conflict'))

      await expect(updateSuite('suite-1', { name: 'x' })).rejects.toThrow('Conflict')
    })
  })
})
