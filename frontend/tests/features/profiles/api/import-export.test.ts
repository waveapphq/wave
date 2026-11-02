/**
 * Profiles Export/Import API Tests
 *
 * Tests for profile export/import API functions.
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
  exportProfile,
  exportProfiles,
  validateProfileImport,
  importProfiles,
} from '@/features/profiles/api/import-export'
import { failedResponse } from '../../../utils/failed-response'
import { installFakeXhr, type FakeXhrHarness } from '../../../utils/fake-xhr'

/** A failed Response with the envelope shape the WAVE backend actually sends. */

describe('Profiles Export/Import API', () => {
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

  describe('exportProfile', () => {
    it('sends GET request with correct URL and default params', async () => {
      const blob = new Blob(['profile content'], { type: 'application/x-yaml' })
      fetchMock.mockResolvedValue({ ok: true, blob: () => Promise.resolve(blob) })

      const result = await exportProfile('profile-123')

      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:8000/profiles/profile-123/export?format=yaml&secrets=mask'
      )
      expect(result).toBeInstanceOf(Blob)
    })

    it('sends request with custom format and secrets mode', async () => {
      const blob = new Blob(['{}'], { type: 'application/json' })
      fetchMock.mockResolvedValue({ ok: true, blob: () => Promise.resolve(blob) })

      await exportProfile('profile-456', { format: 'json', secrets: 'encrypted' })

      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:8000/profiles/profile-456/export?format=json&secrets=encrypted'
      )
    })

    it('throws on non-ok response', async () => {
      fetchMock.mockResolvedValue(failedResponse(404, 'Not Found'))

      await expect(exportProfile('bad-id')).rejects.toThrow('Export failed: Not Found')
    })

    it('reports the reason the server sent, not the status text', async () => {
      fetchMock.mockResolvedValue(
        failedResponse(404, 'Not Found', { error: { message: "Profile 'bad-id' was deleted" } })
      )

      await expect(exportProfile('bad-id')).rejects.toThrow("Profile 'bad-id' was deleted")
    })
  })

  describe('exportProfiles', () => {
    it('sends POST request with profile IDs', async () => {
      const blob = new Blob(['zip content'], { type: 'application/zip' })
      fetchMock.mockResolvedValue({ ok: true, blob: () => Promise.resolve(blob) })

      const result = await exportProfiles(['id-1', 'id-2'])

      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:8000/profiles/export',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profile_ids: ['id-1', 'id-2'], format: 'yaml', secrets: 'mask' }),
        })
      )
      expect(result).toBeInstanceOf(Blob)
    })

    it('throws on non-ok response', async () => {
      fetchMock.mockResolvedValue(failedResponse(400, 'Bad Request'))

      await expect(exportProfiles([])).rejects.toThrow('Export failed: Bad Request')
    })
  })

  describe('validateProfileImport', () => {
    it('sends file via FormData and returns validation result', async () => {
      const mockResult = {
        items: [{ name: 'Prod Profile', status: 'ok', fatal_errors: [], fixable_errors: [], warnings: [], existing_id: null }],
        total: 1,
        importable: 1,
        blocked: 0,
      }
      xhr.answer({ body: { data: mockResult } })

      const file = new File(['content'], 'profiles.yaml', { type: 'application/x-yaml' })
      const result = await validateProfileImport(file)

      expect(xhr.requests[0]).toMatchObject({
        method: 'POST',
        url: 'http://localhost:8000/profiles/import/validate',
      })
      expect(result.total).toBe(1)
      expect(result.items[0].status).toBe('ok')
    })

    it('throws on non-ok response', async () => {
      xhr.answer({ status: 400, statusText: 'Bad Request' })

      const file = new File(['bad'], 'profiles.yaml')
      await expect(validateProfileImport(file)).rejects.toThrow('Validation failed')
    })

    it('transforms legacy format with profiles field to items', async () => {
      const legacyResult = {
        profiles: [
          { name: 'Legacy Profile', status: 'ok', fatal_errors: [], fixable_errors: [], warnings: [], existing_profile_id: 'existing-1' },
        ],
        total: 1,
        importable: 1,
        blocked: 0,
      }
      xhr.answer({ body: { data: legacyResult } })

      const file = new File(['content'], 'profiles.yaml', { type: 'application/x-yaml' })
      const result = await validateProfileImport(file)

      expect(result.items).toHaveLength(1)
      expect(result.items[0].name).toBe('Legacy Profile')
      expect(result.items[0].existing_id).toBe('existing-1')
      expect(result.total).toBe(1)
    })

    it('handles legacy format with missing profiles field', async () => {
      const legacyResult = {
        total: 0,
        importable: 0,
        blocked: 0,
      }
      xhr.answer({ body: { data: legacyResult } })

      const file = new File(['content'], 'profiles.yaml')
      const result = await validateProfileImport(file)

      expect(result.items).toHaveLength(0)
    })

    it('maps existing_profile_id to existing_id with null fallback', async () => {
      const legacyResult = {
        profiles: [
          { name: 'No Existing', status: 'ok', fatal_errors: [], fixable_errors: [], warnings: [] },
        ],
        total: 1,
        importable: 1,
        blocked: 0,
      }
      xhr.answer({ body: { data: legacyResult } })

      const file = new File(['content'], 'profiles.yaml')
      const result = await validateProfileImport(file)

      expect(result.items[0].existing_id).toBeNull()
    })
  })

  describe('importProfiles', () => {
    it('sends file and conflict resolutions via FormData', async () => {
      const mockResult = {
        imported: [{ name: 'Prod Profile', id: 'new-id', action: 'created' }],
        skipped: [],
        fixes_applied: [],
        total_imported: 1,
        total_skipped: 0,
      }
      xhr.answer({ body: { data: mockResult } })

      const file = new File(['content'], 'profiles.yaml')
      const result = await importProfiles(file, { 'Existing Profile': 'rename' })

      expect(xhr.requests[0]).toMatchObject({
        method: 'POST',
        url: 'http://localhost:8000/profiles/import',
      })
      expect(result.total_imported).toBe(1)
    })

    it('throws on non-ok response', async () => {
      xhr.answer({ status: 422, statusText: 'Unprocessable Entity' })

      const file = new File(['bad'], 'profiles.yaml')
      await expect(importProfiles(file)).rejects.toThrow('Import failed')
    })

    it('reports the reason the server sent, not the status text', async () => {
      xhr.answer({
        status: 422,
        statusText: 'Unprocessable Entity',
        body: {
          error: { message: "Profile type 'kafka' is not installed on this server" },
        },
      })

      const file = new File(['bad'], 'profiles.yaml')
      await expect(importProfiles(file)).rejects.toThrow(
        "Profile type 'kafka' is not installed on this server"
      )
    })
  })
})
