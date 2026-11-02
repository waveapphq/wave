/**
 * System Variables API Client Tests
 *
 * Tests for system variable CRUD and the server-side export/import clients.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

import { fetchSystemVariables, saveSystemVariables, deleteAllSystemVariables, deleteSystemVariable } from '@/features/settings/api/global-variables/crud'
import { exportSystemVariables, validateSystemVariablesImport, importSystemVariables } from '@/features/settings/api/global-variables/import-export'
import type { SystemVariablesMap } from '@/features/settings/api/global-variables/types'
import type { ValidateImportResult, ImportResult } from '@/types/import-export'
import { failedResponse } from '../../../../utils/failed-response'

// Mock getApiBaseUrl
vi.mock('@/lib/api', () => ({
  getApiBaseUrl: vi.fn(() => 'http://localhost:8000'),
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    getConfig: vi.fn(() => ({ baseUrl: 'http://localhost:8000' })),
  },
}))

// ============================================================================
// Helpers
// ============================================================================

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsText(blob)
  })
}

/** A failed Response with the envelope shape the WAVE backend actually sends. */

// ============================================================================
// Mock Data
// ============================================================================

const mockVariables: SystemVariablesMap = {
  api_url: { type: 'string', value: 'https://api.example.com', secret: false },
  timeout: { type: 'string', value: '30', secret: false },
}

const mockApiResponse = {
  success: true,
  data: { variables: mockVariables },
  meta: { request_id: 'test-id', timestamp: '2026-01-01T00:00:00Z' },
}

// ============================================================================
// Tests
// ============================================================================

describe('System Variables API', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  describe('fetchSystemVariables', () => {
    it('fetches and returns variables map', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockApiResponse),
      })

      const result = await fetchSystemVariables()

      expect(result).toEqual(mockVariables)
      // cache:'reload' guards the post-import refresh: POST /variables/system/import
      // does not invalidate the browser-cached GET (max-age=60), so the settings
      // surface must always bypass the HTTP cache.
      expect(global.fetch).toHaveBeenCalledWith('http://localhost:8000/variables/system', {
        cache: 'reload',
      })
    })

    it('throws on network error', async () => {
      global.fetch = vi.fn().mockResolvedValue(failedResponse(500, 'Internal Server Error'))

      await expect(fetchSystemVariables()).rejects.toThrow('Failed to fetch system variables')
    })

    it('reports the reason the server sent, not the status text', async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValue(
          failedResponse(500, 'Internal Server Error', {
            error: { message: 'variables/system.yaml is not readable' },
          })
        )

      await expect(fetchSystemVariables()).rejects.toThrow(
        'variables/system.yaml is not readable'
      )
    })
  })

  describe('saveSystemVariables', () => {
    it('saves and returns updated variables', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockApiResponse),
      })

      const result = await saveSystemVariables(mockVariables)

      expect(result).toEqual(mockVariables)
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:8000/variables/system',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      )
    })

    it('throws on validation error with server message', async () => {
      global.fetch = vi.fn().mockResolvedValue(
        failedResponse(400, 'Bad Request', {
          error: { message: "Invalid variable name '123bad'" },
        })
      )

      await expect(saveSystemVariables(mockVariables)).rejects.toThrow("Invalid variable name '123bad'")
    })

    it('throws fallback message when error has no message field', async () => {
      global.fetch = vi.fn().mockResolvedValue(failedResponse(400, 'Bad Request', { error: {} }))

      await expect(saveSystemVariables(mockVariables)).rejects.toThrow(
        'Failed to save system variables: Bad Request'
      )
    })

    it('names the operation and the status when the error body will not parse', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.reject(new Error('parse error')),
      })

      await expect(saveSystemVariables(mockVariables)).rejects.toThrow(
        'Failed to save system variables: Internal Server Error'
      )
    })
  })

  describe('deleteAllSystemVariables', () => {
    it('sends DELETE request', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: true })

      await deleteAllSystemVariables()

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:8000/variables/system',
        expect.objectContaining({ method: 'DELETE' })
      )
    })

    it('throws on failure', async () => {
      global.fetch = vi.fn().mockResolvedValue(failedResponse(500, 'Internal Server Error'))

      await expect(deleteAllSystemVariables()).rejects.toThrow('Failed to delete system variables')
    })
  })

  describe('deleteSystemVariable', () => {
    it('sends DELETE for specific variable', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: true })

      await deleteSystemVariable('my_var')

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:8000/variables/system/my_var',
        expect.objectContaining({ method: 'DELETE' })
      )
    })

    it('throws 404 message for not found', async () => {
      global.fetch = vi.fn().mockResolvedValue(failedResponse(404, 'Not Found'))

      await expect(deleteSystemVariable('missing')).rejects.toThrow("Variable 'missing' not found")
    })

    it('throws generic message for other errors', async () => {
      global.fetch = vi.fn().mockResolvedValue(failedResponse(500, 'Internal Server Error'))

      await expect(deleteSystemVariable('x')).rejects.toThrow('Failed to delete system variable')
    })

    it('reports the reason the server sent, not the status text', async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValue(
          failedResponse(409, 'Conflict', {
            error: { message: "'api_url' is in use by 3 tests" },
          })
        )

      await expect(deleteSystemVariable('api_url')).rejects.toThrow(
        "'api_url' is in use by 3 tests"
      )
    })
  })

  describe('exportSystemVariables', () => {
    function mockBlobResponse(content: string, type: string) {
      const payload = new Blob([content], { type })
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': type }),
        blob: () => Promise.resolve(payload),
        arrayBuffer: () => payload.arrayBuffer(),
      })
    }

    it('downloads the server YAML export without client-side serialization', async () => {
      mockBlobResponse('variables:\n  api_url:\n    value: http://x\n', 'application/x-yaml')

      const blob = await exportSystemVariables('yaml')

      expect(blob).toBeInstanceOf(Blob)
      const text = await readBlob(blob)
      expect(text).toBe('variables:\n  api_url:\n    value: http://x\n')
      // Single GET to the export endpoint; no fetchSystemVariables round-trip
      expect(global.fetch).toHaveBeenCalledTimes(1)
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:8000/variables/system/export?format=yaml&secrets=mask'
      )
    })

    it('downloads the server JSON export', async () => {
      mockBlobResponse('{"variables": {}}', 'application/json')

      const blob = await exportSystemVariables('json')

      const text = await readBlob(blob)
      expect(text).toBe('{"variables": {}}')
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:8000/variables/system/export?format=json&secrets=mask'
      )
    })

    it('forwards a custom secrets mode', async () => {
      mockBlobResponse('variables: {}\n', 'application/x-yaml')

      await exportSystemVariables('yaml', 'encrypted')

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:8000/variables/system/export?format=yaml&secrets=encrypted'
      )
    })

    it('throws the server error message on failure', async () => {
      global.fetch = vi.fn().mockResolvedValue(
        failedResponse(400, 'Bad Request', {
          error: { message: "Invalid format: 'xml'. Must be 'yaml' or 'json'" },
        })
      )

      await expect(exportSystemVariables('json')).rejects.toThrow(
        "Invalid format: 'xml'. Must be 'yaml' or 'json'"
      )
    })

    it('throws the fallback message when the error body is not JSON', async () => {
      global.fetch = vi.fn().mockResolvedValue(failedResponse(500, 'Internal Server Error'))

      await expect(exportSystemVariables('json')).rejects.toThrow(
        'Failed to export system variables: Internal Server Error'
      )
    })

    it('throws the fallback message when the error has no message field', async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValue(failedResponse(500, 'Internal Server Error', { error: {} }))

      await expect(exportSystemVariables('json')).rejects.toThrow(
        'Failed to export system variables: Internal Server Error'
      )
    })
  })

  describe('validateSystemVariablesImport', () => {
    const serverValidateResult: ValidateImportResult = {
      items: [
        {
          name: 'api_url',
          status: 'conflict',
          fatal_errors: [],
          fixable_errors: [],
          warnings: [],
          existing_id: 'api_url',
        },
      ],
      total: 1,
      importable: 1,
      blocked: 0,
    }

    it('posts the file as multipart and returns the server validation result', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, data: serverValidateResult }),
      })
      const file = new File(['variables: {}'], 'vars.yaml', { type: 'application/x-yaml' })

      const result = await validateSystemVariablesImport(file)

      expect(result).toEqual(serverValidateResult)
      expect(global.fetch).toHaveBeenCalledTimes(1)
      const [url, init] = vi.mocked(global.fetch).mock.calls[0]
      expect(url).toBe('http://localhost:8000/variables/system/import/validate')
      expect(init?.method).toBe('POST')
      expect(init?.body).toBeInstanceOf(FormData)
      expect((init?.body as FormData).get('file')).toBe(file)
    })

    it('throws the server error message on parse failure', async () => {
      global.fetch = vi.fn().mockResolvedValue(
        failedResponse(400, 'Bad Request', {
          error: { message: 'Invalid YAML: could not parse file' },
        })
      )
      const file = new File(['{{bad'], 'vars.yaml', { type: 'application/x-yaml' })

      await expect(validateSystemVariablesImport(file)).rejects.toThrow(
        'Invalid YAML: could not parse file'
      )
    })
  })

  describe('importSystemVariables', () => {
    const serverImportResult: ImportResult = {
      imported: [{ name: 'api_url', id: 'api_url', action: 'overwritten' }],
      skipped: [{ name: 'skip_me', reason: 'skipped by user' }],
      fixes_applied: [],
      total_imported: 1,
      total_skipped: 1,
    }

    it('posts the file and resolutions map as multipart and returns the server result', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, data: serverImportResult }),
      })
      const file = new File(['variables: {}'], 'vars.yaml', { type: 'application/x-yaml' })
      const resolutions = { api_url: 'overwrite', skip_me: 'skip' } as const

      const result = await importSystemVariables(file, resolutions)

      expect(result).toEqual(serverImportResult)
      expect(global.fetch).toHaveBeenCalledTimes(1)
      const [url, init] = vi.mocked(global.fetch).mock.calls[0]
      expect(url).toBe('http://localhost:8000/variables/system/import')
      expect(init?.method).toBe('POST')
      const body = init?.body as FormData
      expect(body).toBeInstanceOf(FormData)
      expect(body.get('file')).toBe(file)
      expect(body.get('conflict_resolutions')).toBe(JSON.stringify(resolutions))
    })

    it('throws the server error message on failure', async () => {
      global.fetch = vi.fn().mockResolvedValue(
        failedResponse(400, 'Bad Request', {
          error: { message: 'Invalid JSON in conflict_resolutions' },
        })
      )
      const file = new File(['variables: {}'], 'vars.yaml', { type: 'application/x-yaml' })

      await expect(importSystemVariables(file, {})).rejects.toThrow(
        'Invalid JSON in conflict_resolutions'
      )
    })
  })
})
