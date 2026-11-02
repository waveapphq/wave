/**
 * Tests API Tests
 *
 * Tests for tests API fetch and transformation functions.
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
  fetchTests,
  transformApiTest,
  deleteTest,
  cloneTest,
  batchDeleteTests,
  batchUpdateTests,
  createTest,
  updateTest,
  updateTestMetadata,
  fetchTest,
  fetchTestWorkflow,
} from '@/features/tests/api/crud'
import {
  validateTest,
  fixTest,
} from '@/features/tests/api/validation'
import type { TestApiResponse } from '@/features/tests/api/types'

describe('Tests API', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('fetchTests', () => {
    it('fetches tests successfully', async () => {
      const mockData = [{ id: 'test-1', name: 'Test One', version: '1.0.0', created_at: '2025-01-01', updated_at: '2025-01-01', metadata: {} }]
      const mockPagination = { total: 1, page: 1, per_page: 25, total_pages: 1 }

      vi.mocked(apiClient.get).mockResolvedValue({
        data: mockData,
        meta: { requestId: '' },
        status: 200,
        pagination: mockPagination,
      })

      const result = await fetchTests()

      expect(apiClient.get).toHaveBeenCalledWith('/tests')
      expect(result).toEqual({
        success: true,
        data: mockData,
        pagination: mockPagination,
      })
    })

    it('fetches tests with query parameters', async () => {
      const mockData: TestApiResponse[] = []
      const mockPagination = { total: 0, page: 1, per_page: 10, total_pages: 0 }

      vi.mocked(apiClient.get).mockResolvedValue({
        data: mockData,
        meta: { requestId: '' },
        status: 200,
        pagination: mockPagination,
      })

      await fetchTests({ page: 2, per_page: 10, search: 'login', status: ['passed'], suite_ids: ['suite-1'] })

      expect(apiClient.get).toHaveBeenCalledWith(
        expect.stringMatching(/\/tests\?page=2.*per_page=10.*search=login.*status=passed.*suite_ids=suite-1/)
      )
    })

    it('throws error on fetch failure', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(
        Object.assign(new Error('Internal Server Error'), { type: 'server', status: 500, isRetryable: true })
      )

      await expect(fetchTests()).rejects.toThrow('Internal Server Error')
    })
  })


  describe('transformApiTest', () => {
    it('transforms test with all metadata fields', () => {
      const apiTest: TestApiResponse = {
        id: 'test-1',
        name: 'Login Test',
        version: '1.0.0',
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-15T12:00:00Z',
        suite_count: 1,
        suite_ids: ['suite-1'],
        suite_names: ['Auth Suite'],
        metadata: {
          status: 'passed',
          last_run: '2025-01-15T11:00:00Z',
          tags: ['smoke', 'auth'],
        },
      }

      const result = transformApiTest(apiTest)

      expect(result.id).toBe('test-1')
      expect(result.name).toBe('Login Test')
      expect(result.suiteCount).toBe(1)
      expect(result.suiteIds).toEqual(['suite-1'])
      expect(result.suiteNames).toEqual(['Auth Suite'])
      expect(result.status).toBe('passed')
      expect(result.lastRun).toBe('2025-01-15T11:00:00Z')
      expect(result.tags).toEqual(['smoke', 'auth'])
    })

    it('transforms test with missing metadata', () => {
      const apiTest: TestApiResponse = {
        id: 'test-2',
        name: 'Minimal Test',
        version: '1.0.0',
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
        metadata: {},
      }

      const result = transformApiTest(apiTest)

      expect(result.id).toBe('test-2')
      expect(result.name).toBe('Minimal Test')
      expect(result.suiteCount).toBe(0)
      expect(result.suiteNames).toEqual([])
      expect(result.status).toBe('never_run')
      expect(result.lastRun).toBeNull()
      expect(result.tags).toEqual([])
    })

    it('transforms test with missing created_at and updated_at', () => {
      const apiTest = {
        id: 'test-3',
        name: 'No Timestamps Test',
        version: '1.0.0',
        metadata: {},
      } as TestApiResponse

      const result = transformApiTest(apiTest)

      expect(result.id).toBe('test-3')
      expect(result.name).toBe('No Timestamps Test')
      expect(result.createdAt).toBeNull()
      expect(result.updatedAt).toBeNull()
    })
  })

  describe('deleteTest', () => {
    it('deletes test successfully', async () => {
      vi.mocked(apiClient.delete).mockResolvedValue({
        data: null,
        meta: { requestId: '' },
        status: 204,
      })

      await deleteTest('test-1')

      expect(apiClient.delete).toHaveBeenCalledWith('/tests/test-1')
    })

    it('throws error on delete failure', async () => {
      vi.mocked(apiClient.delete).mockRejectedValue(
        Object.assign(new Error('Not Found'), { type: 'not_found', status: 404, isRetryable: false })
      )

      await expect(deleteTest('test-1')).rejects.toThrow('Not Found')
    })
  })

  describe('cloneTest', () => {
    it('clones test successfully', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { id: 'test-2', name: 'Cloned Test', version: '1.0.0' },
        meta: { requestId: '' },
        status: 201,
      })

      const result = await cloneTest('test-1')

      expect(apiClient.post).toHaveBeenCalledWith('/tests/test-1/clone')
      expect(result.id).toBe('test-2')
    })

    it('throws error on clone failure', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(
        Object.assign(new Error('Conflict'), { type: 'conflict', status: 409, isRetryable: false })
      )

      await expect(cloneTest('test-1')).rejects.toThrow('Conflict')
    })
  })

  describe('batchDeleteTests', () => {
    it('batch deletes tests successfully', async () => {
      const mockResponse = { deleted: ['test-1', 'test-2'], failed: [] }

      vi.mocked(apiClient.delete).mockResolvedValue({
        data: mockResponse,
        meta: { requestId: '' },
        status: 200,
      })

      const result = await batchDeleteTests(['test-1', 'test-2'])

      expect(apiClient.delete).toHaveBeenCalledWith(
        '/tests/batch',
        { ids: ['test-1', 'test-2'] },
        { rawResponse: true }
      )
      expect(result.deleted).toEqual(['test-1', 'test-2'])
    })

    it('throws error on batch delete failure', async () => {
      vi.mocked(apiClient.delete).mockRejectedValue(
        Object.assign(new Error('Internal Server Error'), { type: 'server', status: 500, isRetryable: false })
      )

      await expect(batchDeleteTests(['test-1'])).rejects.toThrow('Internal Server Error')
    })
  })

  describe('batchUpdateTests', () => {
    it('batch updates tests successfully', async () => {
      const updates = [
        { id: 'test-1', metadata: { parent_suite: 'Suite A' } },
        { id: 'test-2', metadata: { parent_suite: 'Suite A' } },
      ]

      vi.mocked(apiClient.patch).mockResolvedValue({
        data: { updated: ['test-1', 'test-2'], failed: [] },
        meta: { requestId: '' },
        status: 200,
      })

      const result = await batchUpdateTests(updates)

      expect(apiClient.patch).toHaveBeenCalledWith('/tests/batch', updates)
      expect(result.updated).toEqual(['test-1', 'test-2'])
    })

    it('throws error on batch update failure', async () => {
      vi.mocked(apiClient.patch).mockRejectedValue(
        Object.assign(new Error('Bad Request'), { type: 'client', status: 400, isRetryable: false })
      )

      await expect(batchUpdateTests([{ id: 'test-1' }])).rejects.toThrow('Bad Request')
    })
  })

  describe('createTest', () => {
    it('creates test successfully', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { id: 'test-new', name: 'New Test', version: '1.0' },
        meta: { requestId: '' },
        status: 201,
      })

      const result = await createTest({
        name: 'New Test',
        description: 'A new test',
        tags: ['tag1'],
        workflow: { nodes: [], edges: [] },
      })

      expect(apiClient.post).toHaveBeenCalledWith(
        '/tests',
        expect.objectContaining({ name: 'New Test' })
      )
      expect(result.id).toBe('test-new')
    })

    it('throws error with status on conflict', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(
        Object.assign(new Error('Test already exists'), { type: 'conflict', status: 409, isRetryable: false })
      )

      try {
        await createTest({ name: 'Existing Test' })
        expect.fail('Should have thrown')
      } catch (err) {
        const error = err as Error & { status?: number }
        expect(error.message).toContain('Test already exists')
        expect(error.status).toBe(409)
      }
    })

    it('throws error with detail message', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(
        Object.assign(new Error('Invalid input'), { type: 'client', status: 400, isRetryable: false })
      )

      await expect(createTest({ name: 'Test' })).rejects.toThrow('Invalid input')
    })

    it('throws error on server failure', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(
        Object.assign(new Error('Internal Server Error'), { type: 'server', status: 500, isRetryable: true })
      )

      await expect(createTest({ name: 'Test' })).rejects.toThrow('Internal Server Error')
    })
  })

  describe('updateTest', () => {
    it('updates test successfully', async () => {
      vi.mocked(apiClient.put).mockResolvedValue({
        data: { id: 'test-1', name: 'Updated Test', version: '2.0' },
        meta: { requestId: '' },
        status: 200,
      })

      const result = await updateTest('test-1', {
        name: 'Updated Test',
        workflow: { nodes: [], edges: [] },
      })

      expect(apiClient.put).toHaveBeenCalledWith(
        '/tests/test-1',
        expect.objectContaining({ name: 'Updated Test' })
      )
      expect(result.name).toBe('Updated Test')
    })

    it('throws error with status on not found', async () => {
      vi.mocked(apiClient.put).mockRejectedValue(
        Object.assign(new Error('Test not found'), { type: 'not_found', status: 404, isRetryable: false })
      )

      try {
        await updateTest('test-missing', { name: 'Test' })
        expect.fail('Should have thrown')
      } catch (err) {
        const error = err as Error & { status?: number }
        expect(error.message).toContain('Test not found')
        expect(error.status).toBe(404)
      }
    })

    it('throws error with detail message', async () => {
      vi.mocked(apiClient.put).mockRejectedValue(
        Object.assign(new Error('Validation failed'), { type: 'client', status: 400, isRetryable: false })
      )

      await expect(updateTest('test-1', { name: '' })).rejects.toThrow('Validation failed')
    })

    it('throws error on server failure', async () => {
      vi.mocked(apiClient.put).mockRejectedValue(
        Object.assign(new Error('Internal Server Error'), { type: 'server', status: 500, isRetryable: true })
      )

      await expect(updateTest('test-1', {})).rejects.toThrow('Internal Server Error')
    })
  })

  describe('updateTestMetadata', () => {
    it('updates test metadata successfully', async () => {
      vi.mocked(apiClient.patch).mockResolvedValue({
        data: { id: 'test-1', name: 'Updated Metadata', version: '1.1' },
        meta: { requestId: '' },
        status: 200,
      })

      const result = await updateTestMetadata('test-1', {
        name: 'Updated Metadata',
        description: 'New description',
        tags: ['tag1', 'tag2'],
      })

      expect(apiClient.patch).toHaveBeenCalledWith(
        '/tests/test-1/metadata',
        expect.objectContaining({ name: 'Updated Metadata' })
      )
      expect(result.name).toBe('Updated Metadata')
    })

    it('throws error with status on conflict', async () => {
      vi.mocked(apiClient.patch).mockRejectedValue(
        Object.assign(new Error('Name already in use'), { type: 'conflict', status: 409, isRetryable: false })
      )

      try {
        await updateTestMetadata('test-1', { name: 'Existing Name' })
        expect.fail('Should have thrown')
      } catch (err) {
        const error = err as Error & { status?: number }
        expect(error.message).toContain('Name already in use')
        expect(error.status).toBe(409)
      }
    })

    it('throws error with detail message', async () => {
      vi.mocked(apiClient.patch).mockRejectedValue(
        Object.assign(new Error('Invalid metadata'), { type: 'client', status: 400, isRetryable: false })
      )

      await expect(updateTestMetadata('test-1', { name: '' })).rejects.toThrow('Invalid metadata')
    })

    it('throws error on server failure', async () => {
      vi.mocked(apiClient.patch).mockRejectedValue(
        Object.assign(new Error('Internal Server Error'), { type: 'server', status: 500, isRetryable: true })
      )

      await expect(updateTestMetadata('test-1', { name: 'Test' })).rejects.toThrow('Internal Server Error')
    })
  })

  describe('fetchTest', () => {
    it('fetches single test successfully', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: {
          id: 'test-1',
          name: 'My Test',
          version: '1.0',
          description: 'A test',
          created_at: '2025-01-01',
          updated_at: '2025-01-02',
          metadata: { tags: ['tag1'] },
        },
        meta: { requestId: '' },
        status: 200,
      })

      const result = await fetchTest('test-1')

      expect(apiClient.get).toHaveBeenCalledWith('/tests/test-1')
      expect(result.id).toBe('test-1')
      expect(result.name).toBe('My Test')
    })

    it('throws error with message from api-client', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(
        Object.assign(new Error('Test not found'), { type: 'not_found', status: 404, isRetryable: false })
      )

      await expect(fetchTest('test-missing')).rejects.toThrow('Test not found')
    })

    it('throws error with detail message', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(
        Object.assign(new Error('Access denied'), { type: 'forbidden', status: 403, isRetryable: false })
      )

      await expect(fetchTest('test-1')).rejects.toThrow('Access denied')
    })

    it('throws error on server failure', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(
        Object.assign(new Error('Internal Server Error'), { type: 'server', status: 500, isRetryable: true })
      )

      await expect(fetchTest('test-1')).rejects.toThrow('Internal Server Error')
    })
  })

  describe('fetchTestWorkflow', () => {
    it('fetches test workflow successfully', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: {
          nodes: [{ id: 'node-1', type: 'workflowNode', position: { x: 0, y: 0 }, data: {} }],
          edges: [{ id: 'edge-1', source: 'node-1', target: 'node-2' }],
        },
        meta: { requestId: '' },
        status: 200,
      })

      const result = await fetchTestWorkflow('test-1')

      expect(apiClient.get).toHaveBeenCalledWith('/tests/test-1/workflow')
      expect(result.nodes).toHaveLength(1)
      expect(result.edges).toHaveLength(1)
    })

    it('throws error with message from api-client', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(
        Object.assign(new Error('Workflow not found'), { type: 'not_found', status: 404, isRetryable: false })
      )

      await expect(fetchTestWorkflow('test-missing')).rejects.toThrow('Workflow not found')
    })

    it('throws error with detail message', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(
        Object.assign(new Error('Access denied'), { type: 'forbidden', status: 403, isRetryable: false })
      )

      await expect(fetchTestWorkflow('test-1')).rejects.toThrow('Access denied')
    })

    it('throws error on server failure', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(
        Object.assign(new Error('Internal Server Error'), { type: 'server', status: 500, isRetryable: true })
      )

      await expect(fetchTestWorkflow('test-1')).rejects.toThrow('Internal Server Error')
    })
  })

  describe('validateTest', () => {
    it('returns validation result on success', async () => {
      const result = { fatal: false, errors: [], warnings: [] }
      vi.mocked(apiClient.post).mockResolvedValue({ data: result, meta: { requestId: '' }, status: 200 })

      const response = await validateTest('test-1')
      expect(response).toEqual(result)
      expect(apiClient.post).toHaveBeenCalledWith('/tests/test-1/validate?context=load')
    })

    it('passes context parameter', async () => {
      const result = { fatal: false, errors: [], warnings: [] }
      vi.mocked(apiClient.post).mockResolvedValue({ data: result, meta: { requestId: '' }, status: 200 })

      await validateTest('test-1', 'run')
      expect(apiClient.post).toHaveBeenCalledWith('/tests/test-1/validate?context=run')
    })

    it('sends an unsaved workflow and its variables for the backend to check', async () => {
      const result = { fatal: false, errors: [], warnings: [] }
      vi.mocked(apiClient.post).mockResolvedValue({ data: result, meta: { requestId: '' }, status: 200 })
      const unsaved = {
        workflow: { nodes: [{ id: 'delay-1' }], edges: [] },
        variables: { limit: { type: 'integer', value: 3 } },
      }

      await validateTest('test-1', 'run', unsaved)
      expect(apiClient.post).toHaveBeenCalledWith('/tests/test-1/validate?context=run', unsaved)
    })

    it('extracts validation result from 422 error details', async () => {
      const validationResult = {
        fatal: false,
        errors: [{ path: 'nodes[0]', code: 'MISSING_LABEL', message: 'Missing label', severity: 'error' }],
        warnings: [],
      }
      const apiError = Object.assign(new Error('Validation failed'), {
        status: 422,
        details: [validationResult],
      })
      vi.mocked(apiClient.post).mockRejectedValue(apiError)

      const response = await validateTest('test-1')
      expect(response).toEqual(validationResult)
    })

    it('re-throws non-422 errors', async () => {
      const apiError = Object.assign(new Error('Server error'), { status: 500 })
      vi.mocked(apiClient.post).mockRejectedValue(apiError)

      await expect(validateTest('test-1')).rejects.toThrow('Server error')
    })

    it('re-throws 422 errors without details', async () => {
      const apiError = Object.assign(new Error('Unprocessable'), { status: 422, details: undefined })
      vi.mocked(apiClient.post).mockRejectedValue(apiError)

      await expect(validateTest('test-1')).rejects.toThrow('Unprocessable')
    })
  })

  describe('fixTest', () => {
    it('returns fixed test data and warnings', async () => {
      const fixedTest = { id: 'test-1', name: 'Fixed Test' }
      const warnings = [{ path: 'nodes[0]', code: 'REQUIRED_PARAM_MISSING', message: 'Param missing', severity: 'warning' as const }]
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { data: fixedTest, warnings },
        meta: { requestId: '' },
        status: 200,
      })

      const result = await fixTest('test-1')
      expect(result.test).toEqual(fixedTest)
      expect(result.warnings).toEqual(warnings)
      expect(apiClient.post).toHaveBeenCalledWith('/tests/test-1/fix', undefined, { rawResponse: true })
    })

    it('defaults warnings to empty array when absent', async () => {
      const fixedTest = { id: 'test-1', name: 'Fixed Test' }
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { data: fixedTest },
        meta: { requestId: '' },
        status: 200,
      })

      const result = await fixTest('test-1')
      expect(result.test).toEqual(fixedTest)
      expect(result.warnings).toEqual([])
    })
  })
})
