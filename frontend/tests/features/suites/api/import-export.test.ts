/**
 * Suites Export/Import API Tests
 *
 * Tests for suite export/import API functions.
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
  exportSuite,
  exportSuites,
  validateSuiteImport,
  importSuites,
} from '@/features/suites/api/export-import'
import { failedResponse } from '../../../utils/failed-response'
import { installFakeXhr, type FakeXhrHarness } from '../../../utils/fake-xhr'

/** A failed Response with the envelope shape the WAVE backend actually sends. */

describe('Suites Export/Import API', () => {
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

  describe('exportSuite', () => {
    it('sends GET request with correct URL and default params', async () => {
      const blob = new Blob(['suite content'], { type: 'application/x-yaml' })
      fetchMock.mockResolvedValue({ ok: true, blob: () => Promise.resolve(blob) })

      const result = await exportSuite('suite-123')

      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:8000/suites/suite-123/export?format=yaml&secrets=mask'
      )
      expect(result).toBeInstanceOf(Blob)
    })

    it('sends request with custom format and secrets mode', async () => {
      const blob = new Blob(['{}'], { type: 'application/json' })
      fetchMock.mockResolvedValue({ ok: true, blob: () => Promise.resolve(blob) })

      await exportSuite('suite-456', { format: 'json', secrets: 'encrypted' })

      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:8000/suites/suite-456/export?format=json&secrets=encrypted'
      )
    })

    it('throws on non-ok response', async () => {
      fetchMock.mockResolvedValue(failedResponse(404, 'Not Found'))

      await expect(exportSuite('bad-id')).rejects.toThrow('Export failed: Not Found')
    })

    it('reports the reason the server sent, not the status text', async () => {
      fetchMock.mockResolvedValue(
        failedResponse(404, 'Not Found', { error: { message: "Suite 'bad-id' was deleted" } })
      )

      await expect(exportSuite('bad-id')).rejects.toThrow("Suite 'bad-id' was deleted")
    })
  })

  describe('exportSuites', () => {
    it('sends POST request with suite IDs', async () => {
      const blob = new Blob(['zip content'], { type: 'application/zip' })
      fetchMock.mockResolvedValue({ ok: true, blob: () => Promise.resolve(blob) })

      const result = await exportSuites(['id-1', 'id-2'])

      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:8000/suites/export',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ suite_ids: ['id-1', 'id-2'], format: 'yaml', secrets: 'mask' }),
        })
      )
      expect(result).toBeInstanceOf(Blob)
    })

    it('throws on non-ok response', async () => {
      fetchMock.mockResolvedValue(failedResponse(400, 'Bad Request'))

      await expect(exportSuites([])).rejects.toThrow('Export failed: Bad Request')
    })
  })

  describe('validateSuiteImport', () => {
    it('sends file via FormData and returns validation result', async () => {
      const mockResult = {
        items: [{ name: 'My Suite', status: 'ok', fatal_errors: [], fixable_errors: [], warnings: [], existing_id: null }],
        total: 1,
        importable: 1,
        blocked: 0,
      }
      xhr.answer({ body: { data: mockResult } })

      const file = new File(['content'], 'suites.yaml', { type: 'application/x-yaml' })
      const result = await validateSuiteImport(file)

      expect(xhr.requests[0]).toMatchObject({
        method: 'POST',
        url: 'http://localhost:8000/suites/import/validate',
      })
      expect(result.total).toBe(1)
      expect(result.items[0].status).toBe('ok')
    })

    it('throws on non-ok response', async () => {
      xhr.answer({ status: 400, statusText: 'Bad Request' })

      const file = new File(['bad'], 'suites.yaml')
      await expect(validateSuiteImport(file)).rejects.toThrow('Validation failed')
    })

    it('transforms backend format with suites field to items', async () => {
      const backendResult = {
        suites: [
          { name: 'Backend Suite', status: 'ok', fatal_errors: [], fixable_errors: [], warnings: [], existing_suite_id: 'existing-1' },
        ],
        total: 1,
        importable: 1,
        blocked: 0,
      }
      xhr.answer({ body: { data: backendResult } })

      const file = new File(['content'], 'suites.yaml', { type: 'application/x-yaml' })
      const result = await validateSuiteImport(file)

      expect(result.items).toHaveLength(1)
      expect(result.items[0].name).toBe('Backend Suite')
      expect(result.items[0].existing_id).toBe('existing-1')
      expect(result.total).toBe(1)
    })

    it('handles missing existing_suite_id with null fallback', async () => {
      const backendResult = {
        suites: [
          { name: 'No Conflict Suite', status: 'ok', fatal_errors: [], fixable_errors: [], warnings: [] },
        ],
        total: 1,
        importable: 1,
        blocked: 0,
      }
      xhr.answer({ body: { data: backendResult } })

      const file = new File(['content'], 'suites.yaml')
      const result = await validateSuiteImport(file)

      expect(result.items[0].existing_id).toBeNull()
    })

    it('handles missing suites array with empty fallback', async () => {
      const backendResult = {
        total: 0,
        importable: 0,
        blocked: 0,
      }
      xhr.answer({ body: { data: backendResult } })

      const file = new File(['content'], 'suites.yaml')
      const result = await validateSuiteImport(file)

      expect(result.items).toEqual([])
    })
  })

  describe('importSuites', () => {
    it('sends file and conflict resolutions via FormData', async () => {
      const mockResult = {
        imported: [{ name: 'Suite A', id: 'new-id', action: 'created' }],
        skipped: [],
        fixes_applied: [],
        total_imported: 1,
        total_skipped: 0,
      }
      xhr.answer({ body: { data: mockResult } })

      const file = new File(['content'], 'suites.yaml')
      const result = await importSuites(file, { 'Suite A': 'rename' })

      expect(xhr.requests[0]).toMatchObject({
        method: 'POST',
        url: 'http://localhost:8000/suites/import',
      })
      expect(result.total_imported).toBe(1)
    })

    it('sends empty resolutions by default', async () => {
      const mockResult = {
        imported: [],
        skipped: [],
        fixes_applied: [],
        total_imported: 0,
        total_skipped: 0,
      }
      xhr.answer({ body: { data: mockResult } })

      const file = new File(['content'], 'suites.yaml')
      await importSuites(file)

      expect(xhr.requests[0].body.get('conflict_resolutions')).toBe('{}')
    })

    it('throws on non-ok response', async () => {
      xhr.answer({ status: 400, statusText: 'Bad Request' })

      const file = new File(['bad'], 'suites.yaml')
      await expect(importSuites(file)).rejects.toThrow('Import failed: Bad Request')
    })

    it('reports the reason the server sent, not the status text', async () => {
      xhr.answer({
        status: 400,
        statusText: 'Bad Request',
        body: {
          error: { message: "Suite 'Smoke' references test 'Login' which is not in the file" },
        },
      })

      const file = new File(['bad'], 'suites.yaml')
      await expect(importSuites(file)).rejects.toThrow(
        "Suite 'Smoke' references test 'Login' which is not in the file"
      )
    })
  })
})
