/**
 * Function Export/Import API client.
 *
 * Tests the rebuilt FE client at `@/features/functions/api/export-import`
 * which mirrors `tests/api/export-import.ts` but talks to the Function
 * endpoints:
 *
 *   - exportFunction(id, {format})        -> GET  /functions/{id}/export
 *   - exportFunctions(ids, {format})      -> POST /functions/export      (Blob; ZIP for 2+)
 *   - validateFunctionImport(file)        -> POST /functions/import/validate
 *   - importFunctions(file, resolutions)  -> POST /functions/import
 *
 * The validate/import results use the SHARED shape from
 * `frontend/src/types/import-export.ts` (`items`/`existing_id`,
 * action created|renamed|overwritten) so the shared dialogs consume them
 * unchanged. The export POST body uses `ids` (no `test_ids`) plus the shared
 * `secrets` mode (mask | encrypted | plaintext).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/api', () => ({
  getApiBaseUrl: vi.fn().mockReturnValue('http://localhost:8000'),
}))

import { getApiBaseUrl } from '@/lib/api'

import {
  exportFunction,
  exportFunctions,
  validateFunctionImport,
  importFunctions,
} from '@/features/functions/api/export-import'
import { failedResponse } from '../../../utils/failed-response'
import { installFakeXhr, type FakeXhrHarness } from '../../../utils/fake-xhr'

/** A failed Response with the envelope shape the WAVE backend actually sends. */

describe('Function Export/Import API client', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let xhr: FakeXhrHarness

  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(getApiBaseUrl).mockReturnValue('http://localhost:8000')
    fetchMock = vi.fn()
    global.fetch = fetchMock as unknown as typeof fetch
    xhr = installFakeXhr()
  })

  afterEach(() => {
    xhr.restore()
    vi.restoreAllMocks()
  })

  describe('exportFunction (single)', () => {
    it('GETs /functions/{id}/export with default yaml format', async () => {
      const blob = new Blob(['id: fn-1\n'], { type: 'application/x-yaml' })
      fetchMock.mockResolvedValue({ ok: true, blob: () => Promise.resolve(blob) })

      const result = await exportFunction('fn-1')

      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:8000/functions/fn-1/export?format=yaml&secrets=mask',
      )
      expect(result).toBeInstanceOf(Blob)
    })

    it('passes format=json when requested', async () => {
      const blob = new Blob(['{}'], { type: 'application/json' })
      fetchMock.mockResolvedValue({ ok: true, blob: () => Promise.resolve(blob) })

      await exportFunction('fn-1', { format: 'json' })

      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:8000/functions/fn-1/export?format=json&secrets=mask',
      )
    })

    it('forwards a custom secrets mode', async () => {
      const blob = new Blob(['id: fn-1\n'], { type: 'application/x-yaml' })
      fetchMock.mockResolvedValue({ ok: true, blob: () => Promise.resolve(blob) })

      await exportFunction('fn-1', { format: 'yaml', secrets: 'encrypted' })

      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:8000/functions/fn-1/export?format=yaml&secrets=encrypted',
      )
    })

    it('throws on non-ok response', async () => {
      fetchMock.mockResolvedValue(failedResponse(404, 'Not Found'))
      await expect(exportFunction('bad')).rejects.toThrow('Export failed: Not Found')
    })

    it('reports the reason the server sent, not the status text', async () => {
      fetchMock.mockResolvedValue(
        failedResponse(404, 'Not Found', { error: { message: "Function 'bad' was deleted" } })
      )
      await expect(exportFunction('bad')).rejects.toThrow("Function 'bad' was deleted")
    })
  })

  describe('exportFunctions (batch)', () => {
    it('POSTs /functions/export with ids, format, and the default secrets mode', async () => {
      const blob = new Blob(['zip'], { type: 'application/zip' })
      fetchMock.mockResolvedValue({ ok: true, blob: () => Promise.resolve(blob) })

      const result = await exportFunctions(['fn-1', 'fn-2'])

      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:8000/functions/export',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: ['fn-1', 'fn-2'], format: 'yaml', secrets: 'mask' }),
        }),
      )
      expect(result).toBeInstanceOf(Blob)
    })

    it('forwards the json format and secrets mode in the body', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(new Blob(['{}'])),
      })

      await exportFunctions(['fn-1'], { format: 'json', secrets: 'encrypted' })

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
      expect(body).toEqual({ ids: ['fn-1'], format: 'json', secrets: 'encrypted' })
    })

    it('throws on non-ok response', async () => {
      fetchMock.mockResolvedValue(failedResponse(400, 'Bad Request'))
      await expect(exportFunctions([])).rejects.toThrow('Export failed: Bad Request')
    })
  })

  describe('validateFunctionImport (dry-run)', () => {
    it('POSTs the file as FormData and returns the shared ValidateImportResult', async () => {
      const mockResult = {
        items: [
          {
            name: 'Greet',
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
      }
      xhr.answer({ body: { data: mockResult } })

      const file = new File(['name: Greet\n'], 'greet.yaml', { type: 'application/x-yaml' })
      const result = await validateFunctionImport(file)

      const sent = xhr.requests[0]
      expect(sent.url).toBe('http://localhost:8000/functions/import/validate')
      expect(sent.method).toBe('POST')
      expect(sent.body).toBeInstanceOf(FormData)
      expect(sent.body.get('file')).toBeInstanceOf(File)
      // Shared shape: items / existing_id (NOT tests / existing_test_id).
      expect(result.total).toBe(1)
      expect(result.items[0].status).toBe('ok')
      expect(result.items[0].existing_id).toBeNull()
    })

    it('surfaces a conflict item with existing_id', async () => {
      xhr.answer({
        body: {
          data: {
            items: [
              {
                name: 'Dup',
                status: 'conflict',
                fatal_errors: [],
                fixable_errors: [],
                warnings: [],
                existing_id: 'fn-existing',
              },
            ],
            total: 1,
            importable: 1,
            blocked: 0,
          },
        },
      })

      const file = new File(['name: Dup\n'], 'dup.yaml')
      const result = await validateFunctionImport(file)
      expect(result.items[0].status).toBe('conflict')
      expect(result.items[0].existing_id).toBe('fn-existing')
    })

    it('throws on non-ok response', async () => {
      xhr.answer({ status: 400, statusText: 'Bad Request' })
      const file = new File(['bad'], 'bad.yaml')
      await expect(validateFunctionImport(file)).rejects.toThrow('Validation failed')
    })
  })

  describe('importFunctions (commit)', () => {
    it('POSTs file + conflict_resolutions and returns the shared ImportResult', async () => {
      const mockResult = {
        imported: [{ name: 'Greet', id: 'new-id', action: 'created' }],
        skipped: [],
        fixes_applied: [],
        total_imported: 1,
        total_skipped: 0,
      }
      xhr.answer({ body: { data: mockResult } })

      const file = new File(['name: Greet\n'], 'greet.yaml')
      const result = await importFunctions(file, { Existing: 'rename' })

      const sent = xhr.requests[0]
      expect(sent.url).toBe('http://localhost:8000/functions/import')
      expect(sent.method).toBe('POST')
      const fd = sent.body
      expect(fd.get('file')).toBeInstanceOf(File)
      expect(JSON.parse(fd.get('conflict_resolutions') as string)).toEqual({
        Existing: 'rename',
      })
      expect(result.total_imported).toBe(1)
      expect(result.imported[0].action).toBe('created')
    })

    it('sends an empty resolutions object when none provided', async () => {
      xhr.answer({
        body: {
          data: {
            imported: [],
            skipped: [],
            fixes_applied: [],
            total_imported: 0,
            total_skipped: 0,
          },
        },
      })

      const file = new File(['name: X\n'], 'x.yaml')
      await importFunctions(file)

      const fd = xhr.requests[0].body
      expect(JSON.parse(fd.get('conflict_resolutions') as string)).toEqual({})
    })

    it('throws on non-ok response', async () => {
      xhr.answer({ status: 422, statusText: 'Unprocessable Entity' })
      const file = new File(['bad'], 'bad.yaml')
      await expect(importFunctions(file)).rejects.toThrow('Import failed')
    })

    it('reports the reason the server sent, not the status text', async () => {
      xhr.answer({
        status: 422,
        statusText: 'Unprocessable Entity',
        body: {
          error: { message: "Version 2.0.0 of 'Login' is published and cannot be overwritten" },
        },
      })
      const file = new File(['bad'], 'bad.yaml')
      await expect(importFunctions(file)).rejects.toThrow(
        "Version 2.0.0 of 'Login' is published and cannot be overwritten"
      )
    })
  })
})
