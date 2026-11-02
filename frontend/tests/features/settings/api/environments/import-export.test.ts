/**
 * Environments Export/Import API Tests
 *
 * Tests for environment export/import API functions.
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
  exportEnvironment,
  exportEnvironments,
  validateEnvironmentImport,
  importEnvironments,
} from '@/features/settings/api/environments/import-export'
import { failedResponse } from '../../../../utils/failed-response'
import { installFakeXhr, type FakeXhrHarness } from '../../../../utils/fake-xhr'

/** A failed Response with the envelope shape the WAVE backend actually sends. */

describe('Environments Export/Import API', () => {
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

  describe('exportEnvironment', () => {
    it('sends GET request with correct URL and default format', async () => {
      const blob = new Blob(['env content'], { type: 'application/x-yaml' })
      fetchMock.mockResolvedValue({ ok: true, blob: () => Promise.resolve(blob) })

      const result = await exportEnvironment('env-123')

      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:8000/environments/env-123/export?format=yaml'
      )
      expect(result).toBeInstanceOf(Blob)
    })

    it('sends request with custom format', async () => {
      const blob = new Blob(['{}'], { type: 'application/json' })
      fetchMock.mockResolvedValue({ ok: true, blob: () => Promise.resolve(blob) })

      await exportEnvironment('env-456', { format: 'json' })

      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:8000/environments/env-456/export?format=json'
      )
    })

    it('does not include a secrets parameter', async () => {
      const blob = new Blob(['content'], { type: 'application/x-yaml' })
      fetchMock.mockResolvedValue({ ok: true, blob: () => Promise.resolve(blob) })

      await exportEnvironment('env-789')

      const calledUrl = fetchMock.mock.calls[0][0] as string
      expect(calledUrl).not.toContain('secrets')
    })

    it('throws on non-ok response', async () => {
      fetchMock.mockResolvedValue(failedResponse(404, 'Not Found'))

      await expect(exportEnvironment('bad-id')).rejects.toThrow('Export failed: Not Found')
    })

    it('reports the reason the server sent, not the status text', async () => {
      fetchMock.mockResolvedValue(
        failedResponse(404, 'Not Found', {
          error: { message: "Environment 'bad-id' was deleted" },
        })
      )

      await expect(exportEnvironment('bad-id')).rejects.toThrow(
        "Environment 'bad-id' was deleted"
      )
    })
  })

  describe('exportEnvironments', () => {
    it('sends POST request with environment IDs', async () => {
      const blob = new Blob(['zip content'], { type: 'application/zip' })
      fetchMock.mockResolvedValue({ ok: true, blob: () => Promise.resolve(blob) })

      const result = await exportEnvironments(['id-1', 'id-2'])

      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:8000/environments/export',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ environment_ids: ['id-1', 'id-2'], format: 'yaml' }),
        })
      )
      expect(result).toBeInstanceOf(Blob)
    })

    it('does not include a secrets field in the request body', async () => {
      const blob = new Blob(['zip'], { type: 'application/zip' })
      fetchMock.mockResolvedValue({ ok: true, blob: () => Promise.resolve(blob) })

      await exportEnvironments(['id-1'])

      const calledBody = JSON.parse(fetchMock.mock.calls[0][1].body as string)
      expect(calledBody).not.toHaveProperty('mask_secrets')
      expect(calledBody).not.toHaveProperty('secrets')
    })

    it('throws on non-ok response', async () => {
      fetchMock.mockResolvedValue(failedResponse(400, 'Bad Request'))

      await expect(exportEnvironments([])).rejects.toThrow('Export failed: Bad Request')
    })
  })

  describe('validateEnvironmentImport', () => {
    it('sends file via FormData and returns validation result', async () => {
      const mockResult = {
        items: [{ name: 'Dev Env', status: 'ok', fatal_errors: [], fixable_errors: [], warnings: [], existing_id: null }],
        total: 1,
        importable: 1,
        blocked: 0,
      }
      xhr.answer({ body: { data: mockResult } })

      const file = new File(['content'], 'environments.yaml', { type: 'application/x-yaml' })
      const result = await validateEnvironmentImport(file)

      expect(xhr.requests[0]).toMatchObject({
        method: 'POST',
        url: 'http://localhost:8000/environments/import/validate',
      })
      expect(result.total).toBe(1)
      expect(result.items[0].status).toBe('ok')
    })

    it('throws on non-ok response', async () => {
      xhr.answer({ status: 400, statusText: 'Bad Request' })

      const file = new File(['bad'], 'environments.yaml')
      await expect(validateEnvironmentImport(file)).rejects.toThrow('Validation failed')
    })

    it('transforms legacy format with environments field to items', async () => {
      const legacyResult = {
        environments: [
          { name: 'Legacy Env', status: 'ok', fatal_errors: [], fixable_errors: [], warnings: [], existing_environment_id: 'existing-1' },
        ],
        total: 1,
        importable: 1,
        blocked: 0,
      }
      xhr.answer({ body: { data: legacyResult } })

      const file = new File(['content'], 'environments.yaml', { type: 'application/x-yaml' })
      const result = await validateEnvironmentImport(file)

      expect(result.items).toHaveLength(1)
      expect(result.items[0].name).toBe('Legacy Env')
      expect(result.items[0].existing_id).toBe('existing-1')
      expect(result.total).toBe(1)
    })

    it('handles legacy format with missing environments field', async () => {
      const legacyResult = {
        total: 0,
        importable: 0,
        blocked: 0,
      }
      xhr.answer({ body: { data: legacyResult } })

      const file = new File(['content'], 'environments.yaml')
      const result = await validateEnvironmentImport(file)

      expect(result.items).toHaveLength(0)
    })

    it('maps existing_environment_id to existing_id with null fallback', async () => {
      const legacyResult = {
        environments: [
          { name: 'No Existing', status: 'ok', fatal_errors: [], fixable_errors: [], warnings: [] },
        ],
        total: 1,
        importable: 1,
        blocked: 0,
      }
      xhr.answer({ body: { data: legacyResult } })

      const file = new File(['content'], 'environments.yaml')
      const result = await validateEnvironmentImport(file)

      expect(result.items[0].existing_id).toBeNull()
    })
  })

  describe('importEnvironments', () => {
    it('sends file and conflict resolutions via FormData', async () => {
      const mockResult = {
        imported: [{ name: 'Dev Env', id: 'new-id', action: 'created' }],
        skipped: [],
        fixes_applied: [],
        total_imported: 1,
        total_skipped: 0,
      }
      xhr.answer({ body: { data: mockResult } })

      const file = new File(['content'], 'environments.yaml')
      const result = await importEnvironments(file, { 'Existing Env': 'rename' })

      expect(xhr.requests[0]).toMatchObject({
        method: 'POST',
        url: 'http://localhost:8000/environments/import',
      })
      expect(result.total_imported).toBe(1)
    })

    it('throws on non-ok response', async () => {
      xhr.answer({ status: 422, statusText: 'Unprocessable Entity' })

      const file = new File(['bad'], 'environments.yaml')
      await expect(importEnvironments(file)).rejects.toThrow('Import failed')
    })

    it('reports the reason the server sent, not the status text', async () => {
      xhr.answer({
        status: 422,
        statusText: 'Unprocessable Entity',
        body: {
          error: { message: "Environment 'staging' already exists and no resolution was given" },
        },
      })

      const file = new File(['bad'], 'environments.yaml')
      await expect(importEnvironments(file)).rejects.toThrow(
        "Environment 'staging' already exists and no resolution was given"
      )
    })
  })
})
