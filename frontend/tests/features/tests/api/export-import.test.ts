/**
 * Tests Export/Import API Tests
 *
 * Tests for test export/import API functions (REQ-5.2.4.9).
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

import { getApiBaseUrl } from '@/lib/api'

import {
  exportTest,
  exportTests,
  validateTestImport,
  importTests,
} from '@/features/tests/api/export-import'
import { failedResponse } from '../../../utils/failed-response'
import { installFakeXhr, type FakeXhrHarness } from '../../../utils/fake-xhr'

/** A failed Response with the envelope shape the WAVE backend actually sends. */

/** An ok Response carrying the export blob and, optionally, a disposition header. */
function okResponse(blob: Blob, disposition?: string) {
  const headers = new Headers()
  if (disposition) headers.set('content-disposition', disposition)
  return { ok: true, headers, blob: () => Promise.resolve(blob) }
}

describe('Tests Export/Import API', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let xhr: FakeXhrHarness

  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(getApiBaseUrl).mockReturnValue('http://localhost:8000')
    fetchMock = vi.fn()
    global.fetch = fetchMock
    xhr = installFakeXhr()
  })

  afterEach(() => {
    xhr.restore()
    vi.restoreAllMocks()
  })

  describe('exportTest', () => {
    it('sends GET request with correct URL and default params', async () => {
      const blob = new Blob(['test content'], { type: 'application/x-yaml' })
      fetchMock.mockResolvedValue(
        okResponse(blob, 'attachment; filename="Login Test.yaml"')
      )

      const result = await exportTest('test-123')

      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:8000/tests/test-123/export?format=yaml&secrets=mask'
      )
      expect(result.blob).toBeInstanceOf(Blob)
    })

    it('sends request with custom format and secrets mode', async () => {
      const blob = new Blob(['{}'], { type: 'application/json' })
      fetchMock.mockResolvedValue(okResponse(blob, 'attachment; filename="Login Test.json"'))

      await exportTest('test-456', { format: 'json', secrets: 'encrypted' })

      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:8000/tests/test-456/export?format=json&secrets=encrypted'
      )
    })

    it('reads the download name from Content-Disposition', async () => {
      const blob = new Blob(['zip content'], { type: 'application/zip' })
      fetchMock.mockResolvedValue(okResponse(blob, 'attachment; filename="Login Test.zip"'))

      const result = await exportTest('test-123', { name: 'Login Test' })

      expect(result.filename).toBe('Login Test.zip')
      expect(result.blob).toBe(blob)
    })

    it('keeps the document name the server sent for a test with no files', async () => {
      const blob = new Blob(['name: Login Test'], { type: 'application/x-yaml' })
      fetchMock.mockResolvedValue(okResponse(blob, 'attachment; filename="Login Test.yaml"'))

      const result = await exportTest('test-123', { name: 'Login Test' })

      expect(result.filename).toBe('Login Test.yaml')
    })

    it('falls back to <name>.zip when the header is missing and the blob is a zip', async () => {
      const blob = new Blob(['zip content'], { type: 'application/zip' })
      fetchMock.mockResolvedValue(okResponse(blob))

      const result = await exportTest('test-123', { name: 'Login Test' })

      expect(result.filename).toBe('Login Test.zip')
    })

    it('falls back to <name>.<format> when the header is missing and the blob is a document', async () => {
      const blob = new Blob(['{}'], { type: 'application/json' })
      fetchMock.mockResolvedValue(okResponse(blob))

      const result = await exportTest('test-123', { format: 'json', name: 'Login Test' })

      expect(result.filename).toBe('Login Test.json')
    })

    it('falls back when the header carries no filename parameter', async () => {
      const blob = new Blob(['zip content'], { type: 'application/zip' })
      fetchMock.mockResolvedValue(okResponse(blob, 'attachment'))

      const result = await exportTest('test-123', { name: 'Login Test' })

      expect(result.filename).toBe('Login Test.zip')
    })

    it('falls back to the default yaml format when none was asked for', async () => {
      const blob = new Blob(['name: Login Test'], { type: 'application/x-yaml' })
      fetchMock.mockResolvedValue(okResponse(blob))

      const result = await exportTest('test-123', { name: 'Login Test' })

      expect(result.filename).toBe('Login Test.yaml')
    })

    it('throws on non-ok response', async () => {
      fetchMock.mockResolvedValue(failedResponse(404, 'Not Found'))

      await expect(exportTest('bad-id')).rejects.toThrow('Export failed: Not Found')
    })

    it('reports the reason the server sent, not the status text', async () => {
      fetchMock.mockResolvedValue(
        failedResponse(404, 'Not Found', {
          error: { message: "Test 'bad-id' does not exist" },
        })
      )

      await expect(exportTest('bad-id')).rejects.toThrow("Test 'bad-id' does not exist")
    })

    it('carries the request context onto the failure', async () => {
      fetchMock.mockResolvedValue(
        failedResponse(500, 'Internal Server Error', {
          error: { message: 'Disk full' },
          meta: { request_id: 'req-9' },
        })
      )

      await expect(exportTest('test-123')).rejects.toMatchObject({
        method: 'GET',
        path: '/tests/test-123/export?format=yaml&secrets=mask',
        status: 500,
        requestId: 'req-9',
      })
    })
  })

  describe('exportTests', () => {
    it('sends POST request with test IDs', async () => {
      const blob = new Blob(['zip content'], { type: 'application/zip' })
      fetchMock.mockResolvedValue(okResponse(blob, 'attachment; filename="tests-export.zip"'))

      const result = await exportTests(['id-1', 'id-2'])

      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:8000/tests/export',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ test_ids: ['id-1', 'id-2'], format: 'yaml', secrets: 'mask' }),
        })
      )
      expect(result).toBeInstanceOf(Blob)
    })

    it('throws on non-ok response', async () => {
      fetchMock.mockResolvedValue(failedResponse(400, 'Bad Request'))

      await expect(exportTests([])).rejects.toThrow('Export failed: Bad Request')
    })

    it('reports the reason the server sent, not the status text', async () => {
      fetchMock.mockResolvedValue(
        failedResponse(400, 'Bad Request', { error: { message: 'No test ids given' } })
      )

      await expect(exportTests([])).rejects.toThrow('No test ids given')
    })

    it('still resolves the bare blob, with no filename wrapper', async () => {
      const blob = new Blob(['zip content'], { type: 'application/zip' })
      fetchMock.mockResolvedValue(okResponse(blob, 'attachment; filename="tests-export.zip"'))

      const result = await exportTests(['id-1', 'id-2'])

      expect(result).toBe(blob)
    })
  })

  describe('validateTestImport', () => {
    it('sends file via FormData and returns validation result', async () => {
      const mockResult = {
        tests: [{ name: 'Test', status: 'ok', fatal_errors: [], fixable_errors: [], warnings: [], existing_test_id: null }],
        total: 1,
        importable: 1,
        blocked: 0,
      }
      xhr.answer({ body: { data: mockResult } })

      const file = new File(['content'], 'test.yaml', { type: 'application/x-yaml' })
      const result = await validateTestImport(file)

      expect(xhr.requests[0]).toMatchObject({
        method: 'POST',
        url: 'http://localhost:8000/tests/import/validate',
      })
      expect(result.total).toBe(1)
      expect(result.tests[0].status).toBe('ok')
    })

    it('throws on non-ok response', async () => {
      xhr.answer({ status: 400, statusText: 'Bad Request' })

      const file = new File(['bad'], 'test.yaml')
      await expect(validateTestImport(file)).rejects.toThrow('Validation failed')
    })

    it('reports the reason the server sent, not the status text', async () => {
      xhr.answer({
        status: 400,
        statusText: 'Bad Request',
        body: {
          error: { message: 'Line 4: expected a mapping, found a list' },
        },
      })

      const file = new File(['bad'], 'test.yaml')
      await expect(validateTestImport(file)).rejects.toThrow(
        'Line 4: expected a mapping, found a list'
      )
    })
  })

  describe('importTests', () => {
    it('sends file and conflict resolutions via FormData', async () => {
      const mockResult = {
        imported: [{ name: 'Test', id: 'new-id', action: 'created' }],
        skipped: [],
        fixes_applied: [],
        total_imported: 1,
        total_skipped: 0,
      }
      xhr.answer({ body: { data: mockResult } })

      const file = new File(['content'], 'test.yaml')
      const result = await importTests(file, { 'Existing': 'rename' })

      expect(xhr.requests[0]).toMatchObject({
        method: 'POST',
        url: 'http://localhost:8000/tests/import',
      })
      expect(result.total_imported).toBe(1)
    })

    it('throws on non-ok response', async () => {
      xhr.answer({ status: 422, statusText: 'Unprocessable Entity' })

      const file = new File(['bad'], 'test.yaml')
      await expect(importTests(file)).rejects.toThrow('Import failed')
    })

    it('reports the reason the server sent, not the status text', async () => {
      xhr.answer({
        status: 422,
        statusText: 'Unprocessable Entity',
        body: {
          error: { message: "Conflict resolution missing for 'Login'" },
        },
      })

      const file = new File(['bad'], 'test.yaml')
      await expect(importTests(file)).rejects.toThrow(
        "Conflict resolution missing for 'Login'"
      )
    })
  })
})
