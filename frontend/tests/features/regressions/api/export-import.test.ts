/**
 * Regression Export/Import API Tests
 *
 * REQ-5.2.1.37: Regression management screen - import/export
 *
 * Tests for the regression export/import API client:
 * - Export single regression as downloadable file (YAML/JSON)
 * - Export multiple regressions as ZIP
 * - Import validates via dry-run
 * - Import executes with conflict resolutions
 * - Format selection
 * - Secret masking toggle
 *
 * API: frontend/src/features/regressions/api/export-import.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock fetch globally for these tests
const mockFetch = vi.fn()
global.fetch = mockFetch

// Mock getApiBaseUrl
vi.mock('@/lib/api', () => ({
  getApiBaseUrl: () => 'http://localhost:8000',
}))

import {
  exportRegression,
  exportRegressions,
  validateRegressionImport,
  importRegressions,
} from '@/features/regressions/api/export-import'
import { failedResponse } from '../../../utils/failed-response'
import { installFakeXhr, type FakeXhrHarness } from '../../../utils/fake-xhr'

/** A failed Response with the envelope shape the WAVE backend actually sends. */

describe('Regression Export/Import API', () => {
  let xhr: FakeXhrHarness

  beforeEach(() => {
    mockFetch.mockReset()
    xhr = installFakeXhr()
  })

  afterEach(() => {
    xhr.restore()
    vi.restoreAllMocks()
  })

  // =========================================================================
  // Export Single Regression
  // =========================================================================

  describe('exportRegression', () => {
    it('calls correct endpoint with default options', async () => {
      const mockBlob = new Blob(['yaml-content'], { type: 'application/x-yaml' })
      mockFetch.mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(mockBlob),
      })

      const result = await exportRegression('reg-1')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/regressions/reg-1/export')
      )
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('format=yaml')
      )
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('secrets=mask')
      )
      expect(result).toBeInstanceOf(Blob)
    })

    it('uses specified format (json)', async () => {
      const mockBlob = new Blob(['{}'], { type: 'application/json' })
      mockFetch.mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(mockBlob),
      })

      await exportRegression('reg-1', { format: 'json' })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('format=json')
      )
    })

    it('passes secrets mode when specified', async () => {
      const mockBlob = new Blob(['yaml-content'])
      mockFetch.mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(mockBlob),
      })

      await exportRegression('reg-1', { secrets: 'encrypted' })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('secrets=encrypted')
      )
    })

    it('throws error on non-ok response', async () => {
      mockFetch.mockResolvedValue(failedResponse(404, 'Not Found'))

      await expect(exportRegression('reg-1')).rejects.toThrow('Export failed: Not Found')
    })

    it('reports the reason the server sent, not the status text', async () => {
      mockFetch.mockResolvedValue(
        failedResponse(404, 'Not Found', {
          error: { message: "Regression 'reg-1' was deleted" },
        })
      )

      await expect(exportRegression('reg-1')).rejects.toThrow(
        "Regression 'reg-1' was deleted"
      )
    })
  })

  // =========================================================================
  // Export Multiple Regressions (batch = ZIP)
  // =========================================================================

  describe('exportRegressions', () => {
    it('calls batch export endpoint with POST', async () => {
      const mockBlob = new Blob(['zip-content'], { type: 'application/zip' })
      mockFetch.mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(mockBlob),
      })

      const result = await exportRegressions(['reg-1', 'reg-2'])

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/regressions/export'),
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            regression_ids: ['reg-1', 'reg-2'],
            format: 'yaml',
            secrets: 'mask',
          }),
        })
      )
      expect(result).toBeInstanceOf(Blob)
    })

    it('passes format and secrets options in batch export', async () => {
      const mockBlob = new Blob(['zip-content'])
      mockFetch.mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(mockBlob),
      })

      await exportRegressions(['reg-1'], { format: 'json', secrets: 'encrypted' })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            regression_ids: ['reg-1'],
            format: 'json',
            secrets: 'encrypted',
          }),
        })
      )
    })

    it('throws error on non-ok batch response', async () => {
      mockFetch.mockResolvedValue(failedResponse(500, 'Internal Server Error'))

      await expect(exportRegressions(['reg-1'])).rejects.toThrow('Export failed: Internal Server Error')
    })
  })

  // =========================================================================
  // Validate Import (Dry-Run)
  // =========================================================================

  describe('validateRegressionImport', () => {
    it('sends file via FormData to validation endpoint', async () => {
      const mockFile = new File(['content'], 'regressions.yaml', { type: 'application/x-yaml' })

      xhr.answer({
        body: {
          data: {
            items: [
              {
                name: 'WAVE 26.04',
                status: 'ok',
                fatal_errors: [],
                fixable_errors: [],
                warnings: [],
                existing_id: null,
              },
            ],
            total: 1,
            importable: 1,
            blocked: 0,
          },
        },
      })

      const result = await validateRegressionImport(mockFile)

      expect(xhr.requests[0].method).toBe('POST')
      expect(xhr.requests[0].url).toContain('/regressions/import/validate')
      expect(xhr.requests[0].body).toBeInstanceOf(FormData)
      expect(result.items).toHaveLength(1)
      expect(result.total).toBe(1)
      expect(result.importable).toBe(1)
    })

    it('returns conflict status for existing regressions', async () => {
      const mockFile = new File(['content'], 'regressions.yaml')

      xhr.answer({
        body: {
          data: {
            items: [
              {
                name: 'Existing Regression',
                status: 'conflict',
                fatal_errors: [],
                fixable_errors: [],
                warnings: [],
                existing_id: 'reg-existing',
              },
            ],
            total: 1,
            importable: 0,
            blocked: 1,
          },
        },
      })

      const result = await validateRegressionImport(mockFile)

      expect(result.items[0].status).toBe('conflict')
      expect(result.items[0].existing_id).toBe('reg-existing')
      expect(result.blocked).toBe(1)
    })

    it('throws error on validation failure', async () => {
      const mockFile = new File(['bad content'], 'invalid.yaml')

      xhr.answer({ status: 400, statusText: 'Bad Request' })

      await expect(validateRegressionImport(mockFile)).rejects.toThrow('Validation failed: Bad Request')
    })

    it('transforms legacy "regressions" payloads to the items shape', async () => {
      const mockFile = new File(['content'], 'regressions.yaml')

      // validateRegressionImport normalizes both { regressions: [...] } and
      // { items: [...] }.
      // Include both a conflict (existing_regression_id set) and a clean
      // import (no existing_regression_id) to exercise both branches of
      // the `?? null` fallback in the mapper.
      xhr.answer({
        body: {
          data: {
            regressions: [
              {
                name: 'Legacy Regression',
                existing_regression_id: 'reg-existing',
                status: 'conflict',
              },
              {
                name: 'Fresh Regression',
                status: 'ok',
              },
            ],
            total: 2,
            importable: 1,
            blocked: 1,
          },
        },
      })

      const result = await validateRegressionImport(mockFile)

      expect(result.items).toHaveLength(2)
      expect(result.items[0].name).toBe('Legacy Regression')
      expect(result.items[0].existing_id).toBe('reg-existing')
      expect(result.items[1].name).toBe('Fresh Regression')
      expect(result.items[1].existing_id).toBeNull()
      expect(result.total).toBe(2)
      expect(result.blocked).toBe(1)
    })

    it('falls back to an empty list when regressions array is missing', async () => {
      const mockFile = new File(['content'], 'regressions.yaml')

      xhr.answer({
        body: {
          data: {
            total: 0,
            importable: 0,
            blocked: 0,
          },
        },
      })

      const result = await validateRegressionImport(mockFile)

      expect(result.items).toEqual([])
      expect(result.total).toBe(0)
    })
  })

  // =========================================================================
  // Import with Conflict Resolution
  // =========================================================================

  describe('importRegressions', () => {
    it('sends file and conflict resolutions via FormData', async () => {
      const mockFile = new File(['content'], 'regressions.yaml')
      const conflictResolutions = { 'Existing Regression': 'overwrite' }

      xhr.answer({
        body: {
          data: {
            imported: [{ name: 'Existing Regression', id: 'reg-1', action: 'overwritten' }],
            skipped: [],
            fixes_applied: [],
            total_imported: 1,
            total_skipped: 0,
          },
        },
      })

      const result = await importRegressions(mockFile, conflictResolutions)

      expect(xhr.requests[0].method).toBe('POST')
      expect(xhr.requests[0].url).toContain('/regressions/import')
      expect(xhr.requests[0].body).toBeInstanceOf(FormData)
      expect(result.total_imported).toBe(1)
      expect(result.imported[0].action).toBe('overwritten')
    })

    it('handles import with no conflicts (empty resolutions)', async () => {
      const mockFile = new File(['content'], 'regressions.yaml')

      xhr.answer({
        body: {
          data: {
            imported: [{ name: 'New Regression', id: 'reg-new', action: 'created' }],
            skipped: [],
            fixes_applied: [],
            total_imported: 1,
            total_skipped: 0,
          },
        },
      })

      const result = await importRegressions(mockFile)

      expect(result.total_imported).toBe(1)
      expect(result.imported[0].action).toBe('created')
    })

    it('handles import with skipped items', async () => {
      const mockFile = new File(['content'], 'regressions.yaml')

      xhr.answer({
        body: {
          data: {
            imported: [],
            skipped: [{ name: 'Problem Regression', reason: 'Schema validation failed' }],
            fixes_applied: [],
            total_imported: 0,
            total_skipped: 1,
          },
        },
      })

      const result = await importRegressions(mockFile, {})

      expect(result.total_skipped).toBe(1)
      expect(result.skipped[0].reason).toBe('Schema validation failed')
    })

    it('throws error on import failure', async () => {
      const mockFile = new File(['content'], 'regressions.yaml')

      xhr.answer({ status: 409, statusText: 'Conflict' })

      await expect(importRegressions(mockFile)).rejects.toThrow('Import failed: Conflict')
    })

    it('reports the reason the server sent, not the status text', async () => {
      const serverFile = new File(['content'], 'regressions.yaml')

      xhr.answer({
        status: 409,
        statusText: 'Conflict',
        body: { error: { message: "Regression 'Nightly' already exists" } },
      })

      await expect(importRegressions(serverFile)).rejects.toThrow(
        "Regression 'Nightly' already exists"
      )
    })
  })
})
